import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bridgeStatus,
  buildScript,
  installBridge,
  previewInstall,
  readClaudeLimits,
  shellQuote,
  uninstallBridge,
  type BridgePaths,
} from "./bridge";
import {
  dropExpired,
  parseClaudeLog,
  parseCodexLog,
  readClaudeUsage,
  readCodexUsage,
  summarize,
} from "./logs";

const NOW = new Date("2026-11-10T12:00:00+08:00");
const ago = (hours: number) =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const claudeLine = (
  id: string,
  timestamp: string,
  usage: object,
  type = "assistant",
) =>
  JSON.stringify({
    type,
    timestamp,
    message: { id, role: "assistant", usage },
  });
const usage = (
  input: number,
  output: number,
  cacheWrite = 0,
  cacheRead = 0,
) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
});

const codexLine = (
  timestamp: string,
  threadTotal: number,
  last: object | null,
  rate?: object,
) =>
  JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: last && {
        total_token_usage: { total_tokens: threadTotal },
        last_token_usage: last,
      },
      rate_limits: rate,
    },
  });
const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "studypal-usage-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Claude Code logs", () => {
  test("counts each response once, however many lines repeat it", () => {
    const text = [
      claudeLine("msg_1", ago(1), usage(10, 100, 1000, 5000)),
      claudeLine("msg_1", ago(1), usage(10, 100, 1000, 5000)),
      claudeLine("msg_2", ago(2), usage(5, 50)),
      JSON.stringify({
        type: "user",
        timestamp: ago(1),
        message: { content: 'mentions "usage"' },
      }),
      claudeLine("msg_3", ago(1), usage(1, 1), "system"),
      '{"usage" broken json',
      "",
    ].join("\n");
    const samples = parseClaudeLog(text);
    expect([...samples.keys()]).toEqual(["msg_1", "msg_2"]);
    expect(samples.get("msg_1")).toMatchObject({
      input: 10,
      output: 100,
      cacheWrite: 1000,
      cacheRead: 5000,
    });
  });

  test("sums into 5-hour, today and 7-day windows", () => {
    const sample = (hours: number, tokens: number) => ({
      at: NOW.getTime() - hours * 3_600_000,
      input: tokens,
      cacheWrite: 0,
      cacheRead: 0,
      output: 0,
    });
    const windows = summarize(
      // 1 h and 6 h ago are today (after Beijing midnight); 13 h ago was yesterday.
      [
        sample(1, 1),
        sample(6, 10),
        sample(13, 100),
        sample(24 * 6, 1000),
        sample(24 * 8, 10000),
        sample(-1, 5),
      ],
      NOW,
    );
    expect(windows.last5h).toMatchObject({ requests: 1, total: 1 });
    expect(windows.today).toMatchObject({ requests: 2, total: 11 });
    expect(windows.last7d).toMatchObject({ requests: 4, total: 1111 });
  });

  test("reads recent transcripts under projects/, skipping old files and duplicates", async () => {
    const project = path.join(dir, "projects", "-Users-me-app");
    mkdirSync(path.join(project, "session", "subagents"), { recursive: true });
    await Bun.write(
      path.join(project, "a.jsonl"),
      claudeLine("msg_1", ago(1), usage(10, 100, 0, 890)) + "\n",
    );
    // A resumed session repeats msg_1 and adds msg_2.
    await Bun.write(
      path.join(project, "session", "subagents", "b.jsonl"),
      [
        claudeLine("msg_1", ago(1), usage(10, 100, 0, 890)),
        claudeLine("msg_2", ago(30), usage(1, 2)),
      ].join("\n"),
    );
    const old = path.join(project, "old.jsonl");
    await Bun.write(old, claudeLine("msg_old", ago(2), usage(999, 999)));
    const longAgo = new Date(NOW.getTime() - 30 * 86_400_000);
    utimesSync(old, longAgo, longAgo);
    for (const name of [
      "a.jsonl",
      path.join("session", "subagents", "b.jsonl"),
    ]) {
      utimesSync(path.join(project, name), NOW, NOW);
    }

    const result = await readClaudeUsage(NOW, dir);
    expect(result.found).toBe(true);
    expect(result.tokens.last5h).toEqual({
      requests: 1,
      input: 10,
      cacheWrite: 0,
      cacheRead: 890,
      output: 100,
      total: 1000,
    });
    expect(result.tokens.last7d).toMatchObject({ requests: 2, total: 1003 });
  });

  test("a machine without Claude Code reports nothing found", async () => {
    const result = await readClaudeUsage(NOW, path.join(dir, "missing"));
    expect(result).toMatchObject({
      found: false,
      tokens: { last7d: { requests: 0, total: 0 } },
    });
  });
});

describe("Codex logs", () => {
  const rate = (
    five: number,
    week: number,
    fiveReset: string,
    weekReset: string,
  ) => ({
    primary: {
      used_percent: five,
      window_minutes: 300,
      resets_at: epoch(fiveReset),
    },
    secondary: {
      used_percent: week,
      window_minutes: 10080,
      resets_at: epoch(weekReset),
    },
  });

  test("counts each request once and keeps the latest limits", () => {
    const log = parseCodexLog(
      [
        codexLine(
          ago(3),
          21500,
          {
            input_tokens: 21423,
            cached_input_tokens: 13056,
            output_tokens: 77,
          },
          rate(1, 3, ago(-2), ago(-100)),
        ),
        // Repeated without new spending: same thread total.
        codexLine(ago(3), 21500, {
          input_tokens: 21423,
          cached_input_tokens: 13056,
          output_tokens: 77,
        }),
        codexLine(
          ago(2),
          43796,
          {
            input_tokens: 22222,
            cached_input_tokens: 21376,
            output_tokens: 74,
          },
          rate(12, 4, ago(-2), ago(-100)),
        ),
        codexLine(ago(1), 43796, null),
        "not json token_count",
      ].join("\n"),
    );
    expect(log.samples).toHaveLength(2);
    // Cached tokens are split out of the input figure.
    expect(log.samples[0]).toMatchObject({
      input: 8367,
      cacheRead: 13056,
      output: 77,
    });
    expect(log.limits).toEqual({
      fiveHour: { usedPercent: 12, resetsAt: ago(-2) },
      sevenDay: { usedPercent: 4, resetsAt: ago(-100) },
      capturedAt: ago(2),
    });
  });

  test("a window past its reset time is dropped", () => {
    const limits = {
      fiveHour: { usedPercent: 80, resetsAt: ago(1) },
      sevenDay: { usedPercent: 40, resetsAt: ago(-50) },
      capturedAt: ago(3),
    };
    expect(dropExpired(limits, NOW)).toEqual({ ...limits, fiveHour: null });
    expect(dropExpired({ ...limits, sevenDay: null }, NOW)).toBeNull();
    expect(dropExpired(null, NOW)).toBeNull();
  });

  test("takes the newest limits across session files", async () => {
    const day = path.join(dir, "sessions", "2026", "11", "10");
    mkdirSync(day, { recursive: true });
    await Bun.write(
      path.join(day, "one.jsonl"),
      codexLine(
        ago(4),
        100,
        { input_tokens: 90, cached_input_tokens: 0, output_tokens: 10 },
        rate(5, 2, ago(-1), ago(-90)),
      ),
    );
    await Bun.write(
      path.join(day, "two.jsonl"),
      codexLine(
        ago(1),
        300,
        { input_tokens: 250, cached_input_tokens: 50, output_tokens: 50 },
        rate(30, 6, ago(-1), ago(-90)),
      ),
    );
    for (const name of ["one.jsonl", "two.jsonl"])
      utimesSync(path.join(day, name), NOW, NOW);

    const result = await readCodexUsage(NOW, dir);
    expect(result.found).toBe(true);
    expect(result.tokens.last5h).toMatchObject({ requests: 2, total: 400 });
    expect(result.limits?.fiveHour?.usedPercent).toBe(30);
    expect(result.limits?.sevenDay?.usedPercent).toBe(6);
  });
});

describe("status line bridge", () => {
  const paths = (): BridgePaths => ({
    settings: path.join(dir, "claude", "settings.json"),
    dataDir: path.join(dir, "data with 'quote"),
  });
  const writeSettings = async (value: object) => {
    mkdirSync(path.join(dir, "claude"), { recursive: true });
    await Bun.write(paths().settings, JSON.stringify(value, null, 2));
  };
  const readSettings = () => Bun.file(paths().settings).json();
  const runScript = async (input: string) => {
    const child = Bun.spawn(
      ["sh", path.join(paths().dataDir, "claude-statusline-bridge.sh")],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    child.stdin.write(input);
    child.stdin.end();
    const [out, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    return { out, code };
  };

  test("quotes shell words safely", () => {
    expect(shellQuote("/a b/c")).toBe("'/a b/c'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test("the preview shows the exact change and writes nothing", async () => {
    await writeSettings({
      model: "opus",
      statusLine: { type: "command", command: "my-status --flag", padding: 2 },
    });
    const preview = await previewInstall(paths());
    expect(JSON.parse(preview.before)).toEqual({
      type: "command",
      command: "my-status --flag",
      padding: 2,
    });
    expect(JSON.parse(preview.after)).toEqual({
      type: "command",
      command: shellQuote(
        path.join(paths().dataDir, "claude-statusline-bridge.sh"),
      ),
      padding: 2,
    });
    expect(preview.scriptContent).toContain("sh -c 'my-status --flag'");
    expect(readdirSync(dir)).toEqual(["claude"]);
    expect(await readSettings()).toMatchObject({
      statusLine: { command: "my-status --flag" },
    });
  });

  test("installing backs up settings, keeps other settings, and the original status line still shows", async () => {
    const original = {
      model: "opus",
      permissions: { allow: ["x"] },
      statusLine: {
        type: "command",
        command: `tr a-z A-Z; echo " it's"`,
        padding: 2,
      },
    };
    await writeSettings(original);

    const backup = await installBridge(paths(), NOW);
    expect(backup).toContain(
      "settings.json.studypal-backup-2026-11-10T04-00-00-000Z",
    );
    expect(await Bun.file(backup!).json()).toEqual(original);
    expect((await bridgeStatus(paths())).installed).toBe(true);
    const settings = await readSettings();
    expect(settings).toMatchObject({
      model: "opus",
      permissions: { allow: ["x"] },
      statusLine: { type: "command", padding: 2 },
    });
    expect(installBridge(paths(), NOW)).rejects.toThrow("已经启用");

    // Claude Code pipes JSON in; the original command still gets it and its output is shown.
    const input = JSON.stringify({
      cwd: "/somewhere",
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: epoch(ago(-2)) },
        seven_day: { used_percentage: 41.2, resets_at: epoch(ago(-90)) },
      },
    });
    const { out, code } = await runScript(input);
    expect(code).toBe(0);
    expect(out).toBe(`${input.toUpperCase()} it's\n`);

    const captured = path.join(paths().dataDir, "claude-statusline.json");
    expect(await Bun.file(captured).text()).toBe(input);
    expect(statSync(captured).mode & 0o077).toBe(0);
    expect(await readClaudeLimits(NOW, paths())).toMatchObject({
      fiveHour: { usedPercent: 23.5, resetsAt: ago(-2) },
      sevenDay: { usedPercent: 41.2, resetsAt: ago(-90) },
    });
  });

  test("uninstalling restores the previous status line exactly and removes the bridge files", async () => {
    const original = {
      model: "opus",
      statusLine: { type: "command", command: "my-status", padding: 2 },
    };
    await writeSettings(original);
    await installBridge(paths(), NOW);
    await uninstallBridge(paths());
    expect(await readSettings()).toEqual(original);
    expect(readdirSync(paths().dataDir)).toEqual([]);
    expect(await readClaudeLimits(NOW, paths())).toBeNull();
  });

  test("with no status line before, the script prints nothing and uninstall removes the setting", async () => {
    await writeSettings({ model: "opus" });
    expect((await previewInstall(paths())).before).toBe("（未设置）");
    await installBridge(paths(), NOW);
    expect(buildScript(paths(), undefined)).not.toContain("sh -c");
    expect(await runScript('{"rate_limits":{}}')).toEqual({ out: "", code: 0 });
    // No usable windows in the captured data.
    expect(await readClaudeLimits(NOW, paths())).toBeNull();
    await uninstallBridge(paths());
    expect(await readSettings()).toEqual({ model: "opus" });
  });

  test("a status line the user changed afterwards is left alone on uninstall", async () => {
    await writeSettings({ statusLine: { type: "command", command: "old" } });
    await installBridge(paths(), NOW);
    await writeSettings({
      statusLine: { type: "command", command: "user-picked-something-else" },
    });
    expect((await bridgeStatus(paths())).installed).toBe(false);
    await uninstallBridge(paths());
    expect(await readSettings()).toEqual({
      statusLine: { type: "command", command: "user-picked-something-else" },
    });
  });

  test("creates settings.json when Claude Code has none, without a backup", async () => {
    expect(await installBridge(paths(), NOW)).toBeNull();
    expect((await readSettings()).statusLine.type).toBe("command");
  });

  test("refuses to touch a settings file that is not a JSON object", async () => {
    mkdirSync(path.join(dir, "claude"), { recursive: true });
    await Bun.write(paths().settings, "[1, 2]");
    expect(installBridge(paths(), NOW)).rejects.toThrow("不是一个 JSON 对象");
    expect(await Bun.file(paths().settings).text()).toBe("[1, 2]");
  });
});
