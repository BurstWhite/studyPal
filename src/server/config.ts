import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

/** Fixed ports so the system calendar can subscribe to a stable URL. */
const DEFAULT_PORT = isProduction ? 47821 : 47822;

function resolveDataDir(): string {
  const fromEnv = process.env.STUDYPAL_DATA_DIR;
  if (fromEnv) return fromEnv;
  if (isProduction) {
    return path.join(homedir(), "Library", "Application Support", "studyPal");
  }
  return path.join(process.cwd(), ".studypal-data");
}

export const config = {
  isProduction,
  port: Number(process.env.STUDYPAL_PORT ?? DEFAULT_PORT),
  /** Set by the desktop shell. When empty (plain `bun dev`), API auth is off. */
  token: process.env.STUDYPAL_TOKEN ?? "",
  /** Pid of the desktop shell; the server exits when that process goes away. */
  parentPid: Number(process.env.STUDYPAL_PARENT_PID ?? 0),
  dataDir: resolveDataDir(),
  /**
   * Keychain service name. Development uses its own, so a dev database and
   * the installed app never read or overwrite each other's secrets.
   */
  secretService: isProduction ? "studyPal" : "studyPal-dev",
};

export function ensureDataDir(): string {
  mkdirSync(config.dataDir, { recursive: true });
  return config.dataDir;
}
