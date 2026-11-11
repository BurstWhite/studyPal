/**
 * Token usage read from the session logs that Claude Code and Codex already
 * keep on this machine. Nothing here writes anywhere or talks to a network.
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface Totals {
  /** Model requests counted. */
  requests: number;
  /** Uncached input, cache writes, cache reads, and output, in tokens. */
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  total: number;
}

export interface TokenWindows {
  last5h: Totals;
  today: Totals;
  last7d: Totals;
}

export interface LimitWindow {
  /** 0 to 100, or above when over the limit. */
  usedPercent: number;
  /** ISO 8601 instant at which the window resets. */
  resetsAt: string;
}

export interface Limits {
  fiveHour: LimitWindow | null;
  sevenDay: LimitWindow | null;
  /** When these figures were recorded. */
  capturedAt: string;
}

/** One model request found in a log. */
interface Sample {
  at: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;
/** Logs untouched for longer than this cannot hold anything in the windows. */
const LOOKBACK_MS = 7 * DAY_MS;

export const claudeHome = () =>
  process.env.STUDYPAL_CLAUDE_HOME ?? path.join(homedir(), ".claude");
export const codexHome = () =>
  process.env.STUDYPAL_CODEX_HOME ?? path.join(homedir(), ".codex");

const emptyTotals = (): Totals => ({
  requests: 0,
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0,
  total: 0,
});

/** Sums samples into the three windows shown in the app. */
export function summarize(samples: Sample[], now: Date): TokenWindows {
  const windows = {
    last5h: emptyTotals(),
    today: emptyTotals(),
    last7d: emptyTotals(),
  };
  // "Today" starts at midnight Beijing time.
  const midnight =
    Math.floor((now.getTime() + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS -
    BEIJING_OFFSET_MS;
  const add = (totals: Totals, sample: Sample) => {
    totals.requests++;
    totals.input += sample.input;
    totals.cacheWrite += sample.cacheWrite;
    totals.cacheRead += sample.cacheRead;
    totals.output += sample.output;
    totals.total +=
      sample.input + sample.cacheWrite + sample.cacheRead + sample.output;
  };
  for (const sample of samples) {
    if (sample.at > now.getTime()) continue;
    if (sample.at > now.getTime() - 7 * DAY_MS) add(windows.last7d, sample);
    if (sample.at >= midnight) add(windows.today, sample);
    if (sample.at > now.getTime() - 5 * HOUR_MS) add(windows.last5h, sample);
  }
  return windows;
}

const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Requests in one Claude Code transcript. A response is logged once per
 * content block, each line repeating the same usage, so lines are
 * de-duplicated by message id.
 */
export function parseClaudeLog(text: string): Map<string, Sample> {
  const samples = new Map<string, Sample>();
  for (const line of text.split("\n")) {
    // Cheap filter before parsing: most lines carry no usage.
    if (!line.includes('"usage"')) continue;
    let entry: {
      type?: string;
      timestamp?: string;
      message?: { id?: string; usage?: Record<string, unknown> };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry.message?.usage;
    const id = entry.message?.id;
    const at = Date.parse(entry.timestamp ?? "");
    if (entry.type !== "assistant" || !usage || !id || Number.isNaN(at))
      continue;
    samples.set(id, {
      at,
      input: number(usage.input_tokens),
      cacheWrite: number(usage.cache_creation_input_tokens),
      cacheRead: number(usage.cache_read_input_tokens),
      output: number(usage.output_tokens),
    });
  }
  return samples;
}

export interface CodexLog {
  samples: Sample[];
  /** The most recent rate-limit snapshot in the file, if any. */
  limits: Limits | null;
}

function codexWindow(raw: unknown): LimitWindow | null {
  const window = raw as { used_percent?: unknown; resets_at?: unknown } | null;
  if (
    !window ||
    typeof window.used_percent !== "number" ||
    typeof window.resets_at !== "number"
  ) {
    return null;
  }
  return {
    usedPercent: window.used_percent,
    resetsAt: new Date(window.resets_at * 1000).toISOString(),
  };
}

/** Requests and the latest rate-limit snapshot in one Codex session log. */
export function parseCodexLog(text: string): CodexLog {
  const samples: Sample[] = [];
  let limits: Limits | null = null;
  let lastThreadTotal = -1;

  for (const line of text.split("\n")) {
    if (!line.includes('"token_count"')) continue;
    let entry: {
      timestamp?: string;
      payload?: {
        type?: string;
        info?: {
          total_token_usage?: Record<string, unknown>;
          last_token_usage?: Record<string, unknown>;
        } | null;
        rate_limits?: { primary?: unknown; secondary?: unknown } | null;
      };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(entry.timestamp ?? "");
    if (entry.payload?.type !== "token_count" || Number.isNaN(at)) continue;

    const last = entry.payload.info?.last_token_usage;
    const threadTotal = number(
      entry.payload.info?.total_token_usage?.total_tokens,
    );
    // The event repeats when nothing new was spent; count each request once.
    if (last && threadTotal !== lastThreadTotal) {
      lastThreadTotal = threadTotal;
      const cached = number(last.cached_input_tokens);
      samples.push({
        at,
        // Codex reports cached tokens as part of the input figure.
        input: Math.max(0, number(last.input_tokens) - cached),
        cacheWrite: number(last.cache_write_input_tokens),
        cacheRead: cached,
        output: number(last.output_tokens),
      });
    }

    const rate = entry.payload.rate_limits;
    if (rate) {
      limits = {
        fiveHour: codexWindow(rate.primary),
        sevenDay: codexWindow(rate.secondary),
        capturedAt: new Date(at).toISOString(),
      };
    }
  }
  return { samples, limits };
}

/** A window whose reset time has passed no longer describes current usage. */
export function dropExpired(limits: Limits | null, now: Date): Limits | null {
  if (!limits) return null;
  const live = (window: LimitWindow | null) =>
    window && new Date(window.resetsAt) > now ? window : null;
  const result = {
    ...limits,
    fiveHour: live(limits.fiveHour),
    sevenDay: live(limits.sevenDay),
  };
  return result.fiveHour || result.sevenDay ? result : null;
}

/** Parsed files, reused until a file's size or modification time changes. */
const cache = new Map<string, { stamp: string; value: unknown }>();

async function readRecent<T>(
  root: string,
  now: Date,
  parse: (text: string) => T,
): Promise<T[]> {
  const results: T[] = [];
  const seen = new Set<string>();
  let files: string[];
  try {
    files = await Array.fromAsync(
      new Bun.Glob("**/*.jsonl").scan({ cwd: root, absolute: true }),
    );
  } catch {
    return results; // the tool is not installed
  }
  for (const file of files) {
    let stamp: string;
    try {
      const stats = statSync(file);
      if (stats.mtimeMs < now.getTime() - LOOKBACK_MS) continue;
      stamp = `${stats.mtimeMs}:${stats.size}`;
    } catch {
      continue;
    }
    seen.add(file);
    const cached = cache.get(file);
    if (cached?.stamp === stamp) {
      results.push(cached.value as T);
      continue;
    }
    try {
      const value = parse(await Bun.file(file).text());
      cache.set(file, { stamp, value });
      results.push(value);
    } catch {
      // A file that vanished or cannot be read is skipped.
    }
  }
  // Forget files that aged out or were deleted.
  for (const file of cache.keys()) {
    if (file.startsWith(root) && !seen.has(file)) cache.delete(file);
  }
  return results;
}

export interface ClaudeUsage {
  /** False when no Claude Code logs exist on this machine. */
  found: boolean;
  tokens: TokenWindows;
}

export async function readClaudeUsage(
  now = new Date(),
  home = claudeHome(),
): Promise<ClaudeUsage> {
  const logs = await readRecent(
    path.join(home, "projects"),
    now,
    parseClaudeLog,
  );
  // A resumed session can repeat a message in a second file.
  const unique = new Map<string, Sample>();
  for (const log of logs)
    for (const [id, sample] of log) unique.set(id, sample);
  return {
    found: logs.length > 0,
    tokens: summarize([...unique.values()], now),
  };
}

export interface CodexUsage {
  found: boolean;
  tokens: TokenWindows;
  limits: Limits | null;
}

export async function readCodexUsage(
  now = new Date(),
  home = codexHome(),
): Promise<CodexUsage> {
  const logs = await readRecent(
    path.join(home, "sessions"),
    now,
    parseCodexLog,
  );
  let latest: Limits | null = null;
  for (const log of logs) {
    if (log.limits && (!latest || log.limits.capturedAt > latest.capturedAt))
      latest = log.limits;
  }
  return {
    found: logs.length > 0,
    tokens: summarize(
      logs.flatMap((log) => log.samples),
      now,
    ),
    limits: dropExpired(latest, now),
  };
}
