/**
 * Mirrors studyPal's schedule into the system calendar through the bundled
 * EventKit helper. Reminders are alarms on those calendar entries, so macOS
 * and iOS deliver them whether or not studyPal is running.
 *
 * Each push sends only what changed since the last one: `calendar_links`
 * remembers, per item, the system event it became and a hash of what was sent.
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "../config";
import {
  DEFAULT_ASSIGNMENT_REMINDERS,
  DEFAULT_EXAM_REMINDERS,
  effectiveReminders,
} from "../reminders";
import { parseRule } from "./recurrence";

const CALENDAR_TITLE = "studyPal";

/** How long before the due time a deadline's calendar entry starts. */
const DEADLINE_ENTRY_MINUTES = 30;

export interface CalendarItem {
  /** Stable identity of the item across pushes, e.g. `event-12`. */
  key: string;
  title: string;
  /** ISO 8601 instants, or `YYYY-MM-DD` local dates (end exclusive) when `allDay`. */
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
  /** Reminders, as minutes before the start. */
  alarms: number[];
  rule: {
    freq: "DAILY" | "WEEKLY";
    interval: number;
    until?: string;
    count?: number;
  } | null;
}

export interface HelperRequest {
  calendarId: string | null;
  calendarTitle: string;
  upserts: (CalendarItem & { eventId: string | null })[];
  deletes: string[];
  /** Event ids to check; the ones no longer in the calendar come back as `missing`. */
  verify?: string[];
  /** `clear` deletes the whole studyPal calendar instead of writing to it. */
  action?: "sync" | "clear";
}

export interface HelperResponse {
  ok: boolean;
  code?: string;
  error?: string;
  calendarId?: string;
  calendarRecreated: boolean;
  eventIds: Record<string, string>;
  /** Of the ids sent in `verify`, those that no longer exist. */
  missing?: string[];
  /** True when `clear` found and deleted the calendar. */
  removed?: boolean;
}

export type HelperRunner = (request: HelperRequest) => Promise<HelperResponse>;

export interface PushResult {
  ok: boolean;
  /** Items now mirrored in the system calendar. */
  total?: number;
  written?: number;
  removed?: number;
  message?: string;
}

const instant = (value: string | Date) =>
  new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Everything the system calendar should show. */
export function buildItems(db: Database): CalendarItem[] {
  const items: CalendarItem[] = [];

  const events = db
    .query(
      "SELECT id, source, source_id, title, location, notes, starts_at, ends_at, all_day, rrule, reminders FROM events ORDER BY id",
    )
    .all() as {
    id: number;
    source: string;
    source_id: string | null;
    title: string;
    location: string | null;
    notes: string | null;
    starts_at: string;
    ends_at: string;
    all_day: number;
    rrule: string | null;
    reminders: string | null;
  }[];
  for (const row of events) {
    const allDay = row.all_day === 1;
    const parsed = row.rrule ? parseRule(row.rrule) : null;
    items.push({
      // Synced rows are re-created on every sync and get new row ids, so they
      // are identified by what they are in the source system instead.
      key: row.source_id ? `${row.source}:${row.source_id}` : `event-${row.id}`,
      title: row.title,
      // All-day events keep the local date they were entered with.
      start: allDay ? row.starts_at.slice(0, 10) : instant(row.starts_at),
      end: allDay ? row.ends_at.slice(0, 10) : instant(row.ends_at),
      allDay,
      location: row.location,
      notes: row.notes,
      url: null,
      alarms: effectiveReminders(
        row.source === "exam" ? DEFAULT_EXAM_REMINDERS : [],
        row.reminders,
      ),
      rule: parsed && {
        freq: parsed.freq,
        interval: parsed.interval,
        ...(parsed.until ? { until: instant(parsed.until) } : {}),
        ...(parsed.count !== undefined ? { count: parsed.count } : {}),
      },
    });
  }

  const assignments = db
    .query(
      `SELECT id, course, title, due_at, url, reminders FROM assignments
       WHERE status = 'open' AND due_at IS NOT NULL ORDER BY id`,
    )
    .all() as {
    id: number;
    course: string | null;
    title: string;
    due_at: string;
    url: string | null;
    reminders: string | null;
  }[];
  for (const row of assignments) {
    const due = new Date(row.due_at);
    items.push({
      key: `assignment-${row.id}`,
      title: `截止：${row.title}`,
      start: instant(new Date(due.getTime() - DEADLINE_ENTRY_MINUTES * 60_000)),
      end: instant(due),
      allDay: false,
      location: null,
      notes: row.course,
      url: row.url,
      // Alarms count back from the entry's start, reminders from the due time.
      alarms: effectiveReminders(
        DEFAULT_ASSIGNMENT_REMINDERS,
        row.reminders,
      ).map((minutes) => minutes - DEADLINE_ENTRY_MINUTES),
      rule: null,
    });
  }

  const blocks = db
    .query(
      "SELECT id, title, starts_at, ends_at, reminders FROM study_blocks WHERE done = 0 ORDER BY id",
    )
    .all() as {
    id: number;
    title: string;
    starts_at: string;
    ends_at: string;
    reminders: string | null;
  }[];
  for (const row of blocks) {
    items.push({
      key: `block-${row.id}`,
      title: row.title,
      start: instant(row.starts_at),
      end: instant(row.ends_at),
      allDay: false,
      location: null,
      notes: null,
      url: null,
      alarms: effectiveReminders([], row.reminders),
      rule: null,
    });
  }
  return items;
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
export const runHelper: HelperRunner = async (request) => {
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

function readSetting<T>(db: Database, key: string): T | undefined {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as {
    value: string;
  } | null;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function writeSetting(db: Database, key: string, value: unknown): void {
  db.query(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

function failureMessage(response: HelperResponse): string {
  if (response.code === "denied") {
    return "没有日历访问权限。请在「系统设置 → 隐私与安全性 → 日历」里允许 studyPal 完全访问。";
  }
  return response.error ?? "写入系统日历失败";
}

/**
 * Checks that everything recorded as written is still in the system calendar,
 * and forgets what is not so the next push writes it again. Without this, a
 * calendar or events deleted in the Calendar app would never come back: an
 * ordinary push only sends what changed in studyPal.
 */
async function forgetMissingEvents(
  db: Database,
  run: HelperRunner,
): Promise<PushResult | undefined> {
  const links = db.query("SELECT key, event_id FROM calendar_links").all() as {
    key: string;
    event_id: string;
  }[];
  const calendarId = readSetting<string>(db, "system_calendar_id") ?? null;
  if (links.length === 0 || calendarId === null) return undefined;

  const response = await run({
    calendarId,
    calendarTitle: CALENDAR_TITLE,
    upserts: [],
    deletes: [],
    verify: links.map((link) => link.event_id),
  });
  if (!response.ok) return { ok: false, message: failureMessage(response) };
  if (response.calendarId)
    writeSetting(db, "system_calendar_id", response.calendarId);

  if (response.calendarRecreated) {
    // The whole calendar is gone; every item has to be written again.
    db.exec("DELETE FROM calendar_links");
    return undefined;
  }
  const missing = new Set(response.missing ?? []);
  const forget = db.query("DELETE FROM calendar_links WHERE key = ?");
  db.transaction(() => {
    for (const link of links)
      if (missing.has(link.event_id)) forget.run(link.key);
  })();
  return undefined;
}

/**
 * Deletes the studyPal calendar from the system, with everything in it, and
 * switches mirroring off so it is not immediately written back.
 */
export async function clearSystemCalendar(
  db: Database,
  run: HelperRunner = runHelper,
): Promise<PushResult> {
  const calendarId = readSetting<string>(db, "system_calendar_id") ?? null;
  // Only the calendar studyPal created is ever deleted, found by its
  // identifier and never by its name.
  if (calendarId !== null) {
    const response = await run({
      calendarId,
      calendarTitle: CALENDAR_TITLE,
      upserts: [],
      deletes: [],
      action: "clear",
    });
    if (!response.ok) return { ok: false, message: failureMessage(response) };
  }
  db.transaction(() => {
    db.exec("DELETE FROM calendar_links");
    db.exec(
      "DELETE FROM settings WHERE key IN ('system_calendar_id', 'system_calendar_last')",
    );
  })();
  setSystemCalendarEnabled(db, false);
  return { ok: true, total: 0, written: 0, removed: 0 };
}

/** Brings the system calendar in line with the database. */
export async function pushToSystemCalendar(
  db: Database,
  run: HelperRunner = runHelper,
  options: { verify?: boolean; retried?: boolean } = {},
): Promise<PushResult> {
  if (options.verify) {
    const failure = await forgetMissingEvents(db, run);
    if (failure) return failure;
  }
  const items = buildItems(db);
  const links = new Map(
    (
      db.query("SELECT key, event_id, hash FROM calendar_links").all() as {
        key: string;
        event_id: string;
        hash: string;
      }[]
    ).map((link) => [link.key, link]),
  );

  const hashes = new Map(
    items.map((item) => [
      item.key,
      createHash("sha1").update(JSON.stringify(item)).digest("hex"),
    ]),
  );
  const upserts = items
    .filter((item) => links.get(item.key)?.hash !== hashes.get(item.key))
    .map((item) => ({
      ...item,
      eventId: links.get(item.key)?.event_id ?? null,
    }));
  const stale = [...links.values()].filter((link) => !hashes.has(link.key));

  if (upserts.length === 0 && stale.length === 0) {
    return { ok: true, total: items.length, written: 0, removed: 0 };
  }

  const response = await run({
    calendarId: readSetting<string>(db, "system_calendar_id") ?? null,
    calendarTitle: CALENDAR_TITLE,
    upserts,
    deletes: stale.map((link) => link.event_id),
  });
  if (!response.ok) return { ok: false, message: failureMessage(response) };
  if (response.calendarId)
    writeSetting(db, "system_calendar_id", response.calendarId);

  if (response.calendarRecreated) {
    // The calendar was deleted outside studyPal; start over in the new one.
    db.exec("DELETE FROM calendar_links");
    if (options.retried)
      return { ok: false, message: "系统日历被反复删除，无法写入" };
    return pushToSystemCalendar(db, run, { retried: true });
  }

  const save = db.query(
    `INSERT INTO calendar_links (key, event_id, hash) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET event_id = excluded.event_id, hash = excluded.hash`,
  );
  const forget = db.query("DELETE FROM calendar_links WHERE key = ?");
  let written = 0;
  db.transaction(() => {
    for (const item of upserts) {
      const eventId = response.eventIds[item.key];
      // An item the helper did not confirm stays unlinked and is retried.
      if (!eventId) continue;
      save.run(item.key, eventId, hashes.get(item.key)!);
      written++;
    }
    for (const link of stale) forget.run(link.key);
  })();

  if (written < upserts.length) {
    return {
      ok: false,
      message: `有 ${upserts.length - written} 项没有写入系统日历`,
    };
  }
  return { ok: true, total: items.length, written, removed: stale.length };
}

export interface SystemCalendarStatus {
  enabled: boolean;
  /** True when studyPal has a calendar of its own in the system. */
  hasCalendar: boolean;
  /** Outcome of the latest push, if there was one. */
  last: (PushResult & { at: string }) | null;
}

export function systemCalendarStatus(db: Database): SystemCalendarStatus {
  return {
    enabled: readSetting<boolean>(db, "system_calendar_enabled") ?? false,
    hasCalendar: readSetting<string>(db, "system_calendar_id") !== undefined,
    last:
      readSetting<PushResult & { at: string }>(db, "system_calendar_last") ??
      null,
  };
}

let queue: Promise<unknown> = Promise.resolve();

/** Pushes now (after any push already running) and records the outcome. */
export function pushNow(
  db: Database,
  run: HelperRunner = runHelper,
  /** Also check that earlier writes are still there; used for manual pushes. */
  options: { verify?: boolean } = {},
): Promise<PushResult> {
  const next = queue.then(async () => {
    let result: PushResult;
    try {
      result = await pushToSystemCalendar(db, run, options);
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    writeSetting(db, "system_calendar_last", {
      ...result,
      at: new Date().toISOString(),
    });
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

/** Clears the system calendar after any push already running. */
export function clearNow(
  db: Database,
  run: HelperRunner = runHelper,
): Promise<PushResult> {
  const next = queue.then(() => clearSystemCalendar(db, run));
  queue = next.catch(() => undefined);
  return next;
}

export function setSystemCalendarEnabled(db: Database, enabled: boolean): void {
  writeSetting(db, "system_calendar_enabled", enabled);
}

let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Call after any change to events, assignments or study blocks. Pushes shortly
 * afterwards when the mirror is switched on; bursts of changes share one push.
 */
export function scheduleSystemCalendarPush(db: Database): void {
  if (!systemCalendarStatus(db).enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void pushNow(db), 1000);
}
