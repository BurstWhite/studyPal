/**
 * The optional Claude Code status line bridge.
 *
 * Claude Code hands its 5-hour and 7-day rate-limit figures only to the
 * status line command. With the user's consent, studyPal points that setting
 * at a small script which saves a copy of the data and then runs whatever
 * command was configured before, so the user's status line looks the same.
 *
 * Installing edits `~/.claude/settings.json`. It happens only on an explicit
 * request, after a backup, and can be undone.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { claudeHome, dropExpired, type Limits } from "./logs";

interface StatusLine {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

type Settings = Record<string, unknown> & { statusLine?: StatusLine };

export interface BridgePaths {
  /** Claude Code's user settings file. */
  settings: string;
  /** Where the bridge script, its captured data and its record are kept. */
  dataDir: string;
}

export const defaultPaths = (): BridgePaths => ({
  settings: path.join(claudeHome(), "settings.json"),
  dataDir: config.dataDir,
});

const scriptPath = (paths: BridgePaths) =>
  path.join(paths.dataDir, "claude-statusline-bridge.sh");
const capturePath = (paths: BridgePaths) =>
  path.join(paths.dataDir, "claude-statusline.json");
/** Remembers the status line setting that was in place before installing. */
const recordPath = (paths: BridgePaths) =>
  path.join(paths.dataDir, "claude-statusline-original.json");

/** Quotes a string for use as one word in a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The script Claude Code will run in place of the previous command. */
export function buildScript(
  paths: BridgePaths,
  originalCommand: string | undefined,
): string {
  const capture = capturePath(paths);
  const lines = [
    "#!/bin/sh",
    "# Installed by studyPal. Saves a copy of the status line data Claude Code",
    "# provides (studyPal reads the rate-limit figures from it), then runs the",
    "# status line command that was configured before, unchanged.",
    "input=$(cat)",
    // Written through a temporary file so a reader never sees half of it, and
    // readable only by the user: the data names the current project folder.
    `(umask 077; printf '%s' "$input" > ${shellQuote(`${capture}.tmp`)}) 2>/dev/null && mv -f ${shellQuote(`${capture}.tmp`)} ${shellQuote(capture)} 2>/dev/null`,
  ];
  if (originalCommand) {
    lines.push(`printf '%s' "$input" | sh -c ${shellQuote(originalCommand)}`);
  }
  return lines.join("\n") + "\n";
}

async function readSettings(paths: BridgePaths): Promise<Settings> {
  const file = Bun.file(paths.settings);
  if (!(await file.exists())) return {};
  const parsed: unknown = JSON.parse(await file.text());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Claude Code 的 settings.json 不是一个 JSON 对象");
  }
  return parsed as Settings;
}

export interface BridgeStatus {
  installed: boolean;
  settingsPath: string;
  /** The status line command currently configured, if any. */
  currentCommand: string | null;
}

export async function bridgeStatus(
  paths = defaultPaths(),
): Promise<BridgeStatus> {
  const settings = await readSettings(paths);
  const command = settings.statusLine?.command ?? null;
  return {
    installed: command === shellQuote(scriptPath(paths)),
    settingsPath: paths.settings,
    currentCommand: command,
  };
}

export interface BridgePreview {
  settingsPath: string;
  scriptPath: string;
  capturePath: string;
  /** The `statusLine` value before and after, as JSON text. */
  before: string;
  after: string;
  scriptContent: string;
}

function plan(paths: BridgePaths, settings: Settings) {
  const original = settings.statusLine;
  const next: StatusLine = {
    ...original,
    type: "command",
    command: shellQuote(scriptPath(paths)),
  };
  return { original, next, script: buildScript(paths, original?.command) };
}

/** Exactly what installing would change, for the user to review first. */
export async function previewInstall(
  paths = defaultPaths(),
): Promise<BridgePreview> {
  const { original, next, script } = plan(paths, await readSettings(paths));
  return {
    settingsPath: paths.settings,
    scriptPath: scriptPath(paths),
    capturePath: capturePath(paths),
    before:
      original === undefined ? "（未设置）" : JSON.stringify(original, null, 2),
    after: JSON.stringify(next, null, 2),
    scriptContent: script,
  };
}

export class BridgeError extends Error {}

/** Installs the bridge. Returns the path of the settings backup, if one was made. */
export async function installBridge(
  paths = defaultPaths(),
  now = new Date(),
): Promise<string | null> {
  if ((await bridgeStatus(paths)).installed)
    throw new BridgeError("已经启用了");
  const settings = await readSettings(paths);
  const { original, next, script } = plan(paths, settings);

  mkdirSync(paths.dataDir, { recursive: true });
  await Bun.write(scriptPath(paths), script);
  chmodSync(scriptPath(paths), 0o755);
  await Bun.write(
    recordPath(paths),
    JSON.stringify({ statusLine: original ?? null }, null, 2),
  );

  let backup: string | null = null;
  if (existsSync(paths.settings)) {
    backup = `${paths.settings}.studypal-backup-${now.toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(paths.settings, backup);
  } else {
    mkdirSync(path.dirname(paths.settings), { recursive: true });
  }
  await Bun.write(
    paths.settings,
    JSON.stringify({ ...settings, statusLine: next }, null, 2) + "\n",
  );
  return backup;
}

/**
 * Puts the previous status line setting back. If the user has since pointed
 * the status line somewhere else, their setting is left alone.
 */
export async function uninstallBridge(paths = defaultPaths()): Promise<void> {
  const status = await bridgeStatus(paths);
  if (status.installed) {
    const settings = await readSettings(paths);
    const recordFile = Bun.file(recordPath(paths));
    const record = (await recordFile.exists())
      ? ((await recordFile.json()) as { statusLine: StatusLine | null })
      : { statusLine: null };
    if (record.statusLine) settings.statusLine = record.statusLine;
    else delete settings.statusLine;
    await Bun.write(paths.settings, JSON.stringify(settings, null, 2) + "\n");
  }
  for (const file of [
    scriptPath(paths),
    capturePath(paths),
    recordPath(paths),
  ]) {
    await Bun.file(file)
      .delete()
      .catch(() => undefined);
  }
}

/** The rate limits in the data the bridge last captured, if still current. */
export async function readClaudeLimits(
  now = new Date(),
  paths = defaultPaths(),
): Promise<Limits | null> {
  const file = Bun.file(capturePath(paths));
  if (!(await file.exists())) return null;
  let data: {
    rate_limits?: Record<
      string,
      { used_percentage?: unknown; resets_at?: unknown }
    >;
  };
  try {
    data = await file.json();
  } catch {
    return null; // caught mid-write, or not JSON
  }
  const window = (name: string) => {
    const raw = data.rate_limits?.[name];
    if (
      typeof raw?.used_percentage !== "number" ||
      typeof raw.resets_at !== "number"
    )
      return null;
    return {
      usedPercent: raw.used_percentage,
      resetsAt: new Date(raw.resets_at * 1000).toISOString(),
    };
  };
  return dropExpired(
    {
      fiveHour: window("five_hour"),
      sevenDay: window("seven_day"),
      capturedAt: new Date(file.lastModified).toISOString(),
    },
    now,
  );
}
