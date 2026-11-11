import type { Database } from "bun:sqlite";
import { expand, parseRule } from "./recurrence";

interface EventRow {
  id: number;
  source: string;
  title: string;
  location: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  all_day: number;
  rrule: string | null;
}

/** One concrete occurrence of an event, as shown on the calendar. */
export interface CalendarEntry {
  id: number;
  source: string;
  title: string;
  location: string | null;
  notes: string | null;
  /** ISO 8601 instants of this occurrence. */
  start: string;
  end: string;
  allDay: boolean;
  /** The series this occurrence belongs to, for editing. */
  series: { startsAt: string; endsAt: string; rrule: string | null };
}

export interface EventInput {
  title: string;
  location: string | null;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  rrule: string | null;
}

export class ValidationError extends Error {}

const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function requireInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value)) {
    throw new ValidationError(`${field} 必须是带时区的 ISO 8601 时间`);
  }
  if (Number.isNaN(new Date(value).getTime())) {
    throw new ValidationError(`${field} 不是有效时间`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new ValidationError(`${field} 必须是文本`);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Validates a request body for creating or replacing an event. */
export function parseEventInput(body: unknown): EventInput {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("请求内容必须是 JSON 对象");
  }
  const raw = body as Record<string, unknown>;

  const title = optionalText(raw.title, "title");
  if (!title) throw new ValidationError("标题不能为空");

  const startsAt = requireInstant(raw.startsAt, "startsAt");
  const endsAt = requireInstant(raw.endsAt, "endsAt");
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw new ValidationError("结束时间必须晚于开始时间");
  }

  const rrule = optionalText(raw.rrule, "rrule");
  if (rrule) {
    try {
      parseRule(rrule);
    } catch (error) {
      throw new ValidationError(`重复规则无效：${(error as Error).message}`);
    }
  }

  return {
    title,
    location: optionalText(raw.location, "location"),
    notes: optionalText(raw.notes, "notes"),
    startsAt,
    endsAt,
    allDay: raw.allDay === true,
    rrule,
  };
}

/**
 * Occurrences overlapping `[from, to)`, sorted by start. The table is small
 * (one row per course slot or manual event), so every row is expanded in
 * memory instead of filtering in SQL, where stored offsets would not compare.
 */
export function listEntries(
  db: Database,
  from: Date,
  to: Date,
): CalendarEntry[] {
  const rows = db.query("SELECT * FROM events").all() as EventRow[];
  const entries: CalendarEntry[] = [];
  for (const row of rows) {
    const occurrences = expand(
      new Date(row.starts_at),
      new Date(row.ends_at),
      row.rrule,
      from,
      to,
    );
    for (const occurrence of occurrences) {
      entries.push({
        id: row.id,
        source: row.source,
        title: row.title,
        location: row.location,
        notes: row.notes,
        start: occurrence.start.toISOString(),
        end: occurrence.end.toISOString(),
        allDay: row.all_day === 1,
        series: {
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          rrule: row.rrule,
        },
      });
    }
  }
  return entries.sort((a, b) => a.start.localeCompare(b.start));
}

export function createEvent(db: Database, input: EventInput): number {
  const result = db
    .query(
      `INSERT INTO events (source, title, location, notes, starts_at, ends_at, all_day, rrule)
       VALUES ('manual', $title, $location, $notes, $startsAt, $endsAt, $allDay, $rrule)`,
    )
    .run({ ...input, allDay: input.allDay ? 1 : 0 });
  return Number(result.lastInsertRowid);
}

export type WriteResult = "ok" | "not-found" | "read-only";

function writable(db: Database, id: number): WriteResult {
  const row = db.query("SELECT source FROM events WHERE id = ?").get(id) as {
    source: string;
  } | null;
  if (!row) return "not-found";
  // Synced events are overwritten by the next sync, so edits would be lost.
  return row.source === "manual" ? "ok" : "read-only";
}

export function updateEvent(
  db: Database,
  id: number,
  input: EventInput,
): WriteResult {
  const state = writable(db, id);
  if (state !== "ok") return state;
  db.query(
    `UPDATE events SET title = $title, location = $location, notes = $notes,
       starts_at = $startsAt, ends_at = $endsAt, all_day = $allDay, rrule = $rrule,
       updated_at = datetime('now')
     WHERE id = $id`,
  ).run({ ...input, allDay: input.allDay ? 1 : 0, id });
  return "ok";
}

export function deleteEvent(db: Database, id: number): WriteResult {
  const state = writable(db, id);
  if (state !== "ok") return state;
  db.query("DELETE FROM events WHERE id = ?").run(id);
  return "ok";
}

export type ClearScope = "manual" | "synced" | "all";

export function isClearScope(value: unknown): value is ClearScope {
  return value === "manual" || value === "synced" || value === "all";
}

/** How many events each clear scope would remove. */
export function countEvents(db: Database): Record<ClearScope, number> {
  const row = db
    .query(
      `SELECT count(*) AS total, coalesce(sum(source = 'manual'), 0) AS manual FROM events`,
    )
    .get() as { total: number; manual: number };
  return { manual: row.manual, synced: row.total - row.manual, all: row.total };
}

/**
 * Deletes events in bulk and returns how many were removed. Synced classes
 * come back with the next sync from the academic system.
 */
export function clearEvents(db: Database, scope: ClearScope): number {
  const where =
    scope === "manual"
      ? "source = 'manual'"
      : scope === "synced"
        ? "source != 'manual'"
        : "1";
  return db.query(`DELETE FROM events WHERE ${where}`).run().changes;
}
