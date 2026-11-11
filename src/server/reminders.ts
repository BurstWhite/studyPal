/**
 * Reminders attached to events, assignments and study blocks, each stored as
 * a list of lead times in minutes. They become alarms in the system calendar,
 * so they only sound while mirroring to the system calendar is switched on.
 */
import type { Database } from "bun:sqlite";

/** Every assignment with a deadline is reminded 48 and 24 hours ahead. */
export const DEFAULT_ASSIGNMENT_REMINDERS = [48 * 60, 24 * 60];
/** Every exam is reminded a week and a day ahead. */
export const DEFAULT_EXAM_REMINDERS = [7 * 24 * 60, 24 * 60];

const MAX_REMINDERS = 5;
/** Four weeks; nothing needs a reminder further ahead than that. */
const MAX_LEAD_MINUTES = 28 * 24 * 60;

export type ReminderTarget = "event" | "assignment" | "study_block";

const TABLES: Record<ReminderTarget, string> = {
  event: "events",
  assignment: "assignments",
  study_block: "study_blocks",
};

export class ReminderError extends Error {}

/**
 * Validates a list of lead times and returns it longest first without
 * duplicates. An empty list is valid and means "no extra reminders".
 */
export function parseReminders(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new ReminderError("提醒时间必须是一个分钟数的列表");
  }
  if (value.length > MAX_REMINDERS) {
    throw new ReminderError(`一项最多设置 ${MAX_REMINDERS} 个提醒`);
  }
  for (const minutes of value) {
    if (
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > MAX_LEAD_MINUTES
    ) {
      throw new ReminderError(
        `每个提醒必须是 0 到 ${MAX_LEAD_MINUTES} 之间的整数分钟（最多提前 4 周）`,
      );
    }
  }
  return [...new Set(value as number[])].sort((a, b) => b - a);
}

/** Reads a stored list of extra reminders; anything unreadable counts as none. */
export function readReminders(stored: string | null): number[] {
  if (stored === null) return [];
  try {
    return parseReminders(JSON.parse(stored));
  } catch {
    return [];
  }
}

/**
 * The reminders an item actually gets: the built-in ones for its kind plus
 * the ones the user asked for, longest first.
 */
export function effectiveReminders(
  defaults: number[],
  stored: string | null,
): number[] {
  return [...new Set([...defaults, ...readReminders(stored)])].sort(
    (a, b) => b - a,
  );
}

/**
 * Stores the reminders the user asked for on an item, replacing earlier
 * ones. Built-in reminders are unaffected. Returns false when the item does
 * not exist.
 */
export function setReminders(
  db: Database,
  target: ReminderTarget,
  id: number,
  minutes: number[],
): boolean {
  const result = db
    .query(`UPDATE ${TABLES[target]} SET reminders = ? WHERE id = ?`)
    .run(minutes.length === 0 ? null : JSON.stringify(minutes), id);
  return result.changes > 0;
}

/** A lead time in words: 提前 2 天, 提前 1 小时 30 分钟, 准时. */
export function describeLead(minutes: number): string {
  if (minutes === 0) return "准时";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days > 0 ? `${days} 天` : "",
    hours > 0 ? `${hours} 小时` : "",
    rest > 0 ? `${rest} 分钟` : "",
  ].filter(Boolean);
  return `提前 ${parts.join(" ")}`;
}
