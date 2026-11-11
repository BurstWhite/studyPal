/**
 * Finds free time between existing commitments. Days are Beijing days: the
 * app is built around a ZJU timetable, so "8 o'clock" always means +08:00.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const ZONE_OFFSET_MS = 8 * HOUR_MS;

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotOptions {
  /** Hours of the day (Beijing time) inside which slots may fall. */
  dayStartHour?: number;
  dayEndHour?: number;
  /** Slots shorter than this are left out. */
  minMinutes?: number;
}

/** Sorts intervals and joins the ones that overlap or touch. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/**
 * Free intervals within `[from, to)`, limited to the waking window of each
 * day and to gaps of at least `minMinutes`.
 */
export function freeSlots(
  busy: Interval[],
  from: Date,
  to: Date,
  options: SlotOptions = {},
): Interval[] {
  const { dayStartHour = 8, dayEndHour = 22, minMinutes = 30 } = options;
  const taken = mergeIntervals(busy);
  const slots: Interval[] = [];

  // Midnight (Beijing time) of the day containing `from`.
  const firstDay =
    Math.floor((from.getTime() + ZONE_OFFSET_MS) / DAY_MS) * DAY_MS -
    ZONE_OFFSET_MS;

  for (let day = firstDay; day < to.getTime(); day += DAY_MS) {
    let cursor = Math.max(day + dayStartHour * HOUR_MS, from.getTime());
    const windowEnd = Math.min(day + dayEndHour * HOUR_MS, to.getTime());

    const push = (end: number) => {
      if (end - cursor >= minMinutes * 60_000) {
        slots.push({ start: new Date(cursor), end: new Date(end) });
      }
    };
    for (const interval of taken) {
      if (interval.end.getTime() <= cursor) continue;
      if (interval.start.getTime() >= windowEnd) break;
      push(Math.min(interval.start.getTime(), windowEnd));
      cursor = Math.max(cursor, interval.end.getTime());
    }
    if (cursor < windowEnd) push(windowEnd);
  }
  return slots;
}

/** Formats an instant as ISO 8601 in Beijing time, e.g. `2026-11-10T09:00:00+08:00`. */
export function toBeijingIso(date: Date): string {
  return new Date(date.getTime() + ZONE_OFFSET_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+08:00");
}
