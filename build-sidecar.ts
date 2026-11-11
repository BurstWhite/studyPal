/**
 * Builds the two executables the Tauri shell bundles: the Bun server (with the
 * React app embedded), which it launches as its sidecar, and the Swift helper
 * the server uses to write into the system calendar.
 *
 * Tauri expects `<name>-<target triple>` under `src-tauri/binaries/`.
 */
import tailwind from "bun-plugin-tailwind";
import path from "node:path";

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
  },
  compile: { outfile },
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
    path.join(import.meta.dir, "src-tauri", "eventkit", "main.swift"),
    "-o",
    helper,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (swift.exitCode !== 0) process.exit(swift.exitCode ?? 1);
console.log(`Built ${path.relative(import.meta.dir, helper)}`);
