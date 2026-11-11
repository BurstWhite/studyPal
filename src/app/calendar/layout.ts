import type { CalendarEntry } from "../../server/calendar/store";
import { addDays } from "./dates";

const DAY_MINUTES = 24 * 60;

/** A timed entry clipped to one day and placed in a column. */
export interface PlacedEntry {
  entry: CalendarEntry;
  /** Minutes from local midnight of the day. */
  startMinute: number;
  endMinute: number;
  /** Column index and column count of the overlap group it sits in. */
  column: number;
  columns: number;
}

/**
 * Lays out the timed entries of one day. Entries that overlap share the
 * width: each takes the first free column, and a group of mutually connected
 * overlaps is as wide as its busiest moment.
 */
export function placeDay(entries: CalendarEntry[], day: Date): PlacedEntry[] {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();

  const clipped = entries
    .filter((entry) => !entry.allDay)
    .map((entry) => {
      const start = new Date(entry.start).getTime();
      const end = new Date(entry.end).getTime();
      return { entry, start, end };
    })
    .filter(({ start, end }) => start < dayEnd && end > dayStart)
    .map(({ entry, start, end }) => ({
      entry,
      startMinute: Math.max(0, (start - dayStart) / 60_000),
      endMinute: Math.min(DAY_MINUTES, (end - dayStart) / 60_000),
    }))
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const placed: PlacedEntry[] = [];
  let group: PlacedEntry[] = [];
  let groupEnd = -1;
  let columnEnds: number[] = [];

  const closeGroup = () => {
    for (const item of group) item.columns = columnEnds.length;
    group = [];
    columnEnds = [];
  };

  for (const item of clipped) {
    if (group.length > 0 && item.startMinute >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((end) => end <= item.startMinute);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = item.endMinute;
    groupEnd = Math.max(groupEnd, item.endMinute);

    const entry: PlacedEntry = { ...item, column, columns: 1 };
    group.push(entry);
    placed.push(entry);
  }
  closeGroup();
  return placed;
}

/** All-day entries that cover `day`. */
export function allDayEntries(
  entries: CalendarEntry[],
  day: Date,
): CalendarEntry[] {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  return entries.filter(
    (entry) =>
      entry.allDay &&
      new Date(entry.start).getTime() < dayEnd &&
      new Date(entry.end).getTime() > dayStart,
  );
}
