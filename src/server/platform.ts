/**
 * The desktop's half of `@studypal/core/platform`: SQLite through
 * `bun:sqlite`, secrets in the macOS keychain, the bundled EventKit helper for
 * the system calendar, and `/usr/bin/open` for links.
 */
import { Database } from "bun:sqlite";
import { secrets } from "bun";
import path from "node:path";
import type {
  HelperResponse,
  HelperRunner,
} from "@studypal/core/calendar/system";
import { migrate, prepareConnection } from "@studypal/core/db";
import { configurePlatform, type Platform } from "@studypal/core/platform";
import { config, ensureDataDir } from "./config";

export function openDatabase(file?: string): Database {
  const filename = file ?? path.join(ensureDataDir(), "studypal.sqlite");
  const db = new Database(filename, { create: true, strict: true });
  prepareConnection(db);
  migrate(db);
  return db;
}

function helperPath(): string {
  if (process.env.STUDYPAL_EVENTKIT) return process.env.STUDYPAL_EVENTKIT;
  // Packaged: Tauri places the helper next to the server executable.
  if (config.isProduction) {
    return path.join(path.dirname(process.execPath), "studypal-eventkit");
  }
  const triple =
    process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  return path.join(
    process.cwd(),
    "src-tauri",
    "binaries",
    `studypal-eventkit-${triple}`,
  );
}

/** Runs the EventKit helper. The first run shows the system permission prompt. */
export const runEventKitHelper: HelperRunner = async (request) => {
  let child;
  try {
    child = Bun.spawn([helperPath()], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return {
      ok: false,
      code: "failed",
      error: "找不到日历辅助程序",
      calendarRecreated: false,
      eventIds: {},
    };
  }
  child.stdin.write(JSON.stringify(request));
  child.stdin.end();
  const [output] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  try {
    return JSON.parse(output) as HelperResponse;
  } catch {
    return {
      ok: false,
      code: "failed",
      error: "日历辅助程序没有返回结果",
      calendarRecreated: false,
      eventIds: {},
    };
  }
};

export const desktopPlatform: Platform = {
  openDb: () => openDatabase(),
  secrets: {
    get: (name) => secrets.get({ service: config.secretService, name }),
    set: (name, value) =>
      secrets.set({ service: config.secretService, name, value }),
    delete: async (name) => {
      await secrets.delete({ service: config.secretService, name });
    },
  },
  calendar: runEventKitHelper,
  zjuFetch: (url, init) => fetch(url, init),
  openUrl: async (url) => {
    // The URL is passed as a single argument; no shell is involved.
    const child = Bun.spawn(["/usr/bin/open", url], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await child.exited) !== 0) throw new Error("open failed");
  },
  builtAt: config.builtAt,
};

export function useDesktopPlatform(): void {
  configurePlatform(desktopPlatform);
}
