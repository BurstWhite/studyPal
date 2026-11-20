/**
 * Builds the two executables the Tauri shell bundles: the Bun server (with the
 * React app embedded), which it launches as its sidecar, and the Swift helper
 * the server uses to write into the system calendar.
 *
 * Tauri expects `<name>-<target triple>` under `src-tauri/binaries/`.
 *
 * Both must run on the oldest macOS the app supports (`MIN_MACOS`, which
 * matches `minimumSystemVersion` in `tauri.conf.json`). `bun build --compile`
 * copies the running Bun into the server, so a Bun built for a newer macOS
 * (e.g. Homebrew's, built on the build machine) would raise the bar. Point
 * `STUDYPAL_BUN_RUNTIME` at an official Bun of the same version to avoid
 * that. With `STUDYPAL_DIST=1` (`bun run app:dist`) a binary that needs a
 * newer macOS fails the build; otherwise it is reported as a warning.
 */
import tailwind from "bun-plugin-tailwind";
import path from "node:path";

/** Calendar access through `requestFullAccessToEvents` needs macOS 14. */
const MIN_MACOS = "14.0";

const triples: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
};

const triple = triples[`${process.platform}-${process.arch}`];
if (!triple) {
  throw new Error(
    `Unsupported build host: ${process.platform}-${process.arch}`,
  );
}

const outfile = path.join(
  import.meta.dir,
  "src-tauri",
  "binaries",
  `studypal-server-${triple}`,
);

const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "src", "index.ts")],
  plugins: [tailwind],
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    // Shown in the settings page so it is clear which build is running.
    "process.env.STUDYPAL_BUILT_AT": JSON.stringify(new Date().toISOString()),
  },
  compile: {
    outfile,
    ...(process.env.STUDYPAL_BUN_RUNTIME
      ? { executablePath: process.env.STUDYPAL_BUN_RUNTIME }
      : {}),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Built ${path.relative(import.meta.dir, outfile)}`);

// The EventKit helper that writes into the system calendar.
const helper = path.join(
  import.meta.dir,
  "src-tauri",
  "binaries",
  `studypal-eventkit-${triple}`,
);
const swift = Bun.spawnSync(
  [
    "swiftc",
    "-O",
    "-swift-version",
    "5",
    "-target",
    `${triple.split("-")[0] === "aarch64" ? "arm64" : "x86_64"}-apple-macos${MIN_MACOS}`,
    path.join(import.meta.dir, "src-tauri", "eventkit", "main.swift"),
    "-o",
    helper,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (swift.exitCode !== 0) process.exit(swift.exitCode ?? 1);
console.log(`Built ${path.relative(import.meta.dir, helper)}`);

/** The macOS version a Mach-O binary declares as its minimum. */
function minimumMacos(file: string): string | undefined {
  const otool = Bun.spawnSync(["otool", "-l", file]);
  const text = otool.stdout.toString();
  const build = text.slice(text.indexOf("LC_BUILD_VERSION"));
  return /minos (\S+)/.exec(build)?.[1];
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    const diff = (x![i] ?? 0) - (y![i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
};

const tooNew = [outfile, helper]
  .map((file) => ({ file, minos: minimumMacos(file) }))
  .filter(({ minos }) => minos && newer(minos, MIN_MACOS));
for (const { file, minos } of tooNew) {
  console.warn(
    `${path.basename(file)} needs macOS ${minos}, newer than the supported ${MIN_MACOS}.`,
  );
}
if (tooNew.length > 0) {
  console.warn(
    "Set STUDYPAL_BUN_RUNTIME to an official Bun build of the same version (see the top of this file).",
  );
  if (process.env.STUDYPAL_DIST === "1") process.exit(1);
}
