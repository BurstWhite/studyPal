import { expect, test } from "bun:test";
import type { CalendarEntry } from "../../server/calendar/store";
import { startOfWeek, toLocalIso } from "./dates";
import { allDayEntries, placeDay } from "./layout";

const day = new Date(2026, 10, 10);

function entry(
  id: number,
  start: Date,
  end: Date,
  allDay = false,
): CalendarEntry {
  return {
    id,
    source: "manual",
    title: `e${id}`,
    location: null,
    notes: null,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    series: {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      rrule: null,
    },
  };
}

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

test("entries that do not overlap each take the full width", () => {
  const placed = placeDay(
    [entry(1, at(10, 8), at(10, 9)), entry(2, at(10, 9), at(10, 10))],
    day,
  );
  expect(placed.map((p) => [p.column, p.columns])).toEqual([
    [0, 1],
    [0, 1],
  ]);
  expect(placed[0]).toMatchObject({ startMinute: 480, endMinute: 540 });
});

test("overlapping entries share the width and reuse freed columns", () => {
  const placed = placeDay(
    [
      entry(1, at(10, 8), at(10, 10)),
      entry(2, at(10, 9), at(10, 11)),
      entry(3, at(10, 10), at(10, 12)),
      entry(4, at(10, 14), at(10, 15)),
    ],
    day,
  );
  expect(placed.map((p) => [p.entry.id, p.column, p.columns])).toEqual([
    [1, 0, 2],
    [2, 1, 2],
    [3, 0, 2],
    [4, 0, 1],
  ]);
});

test("entries are clipped to the day and other days are left out", () => {
  const placed = placeDay(
    [
      entry(1, at(9, 23), at(10, 1)),
      entry(2, at(10, 23), at(11, 2)),
      entry(3, at(11, 8), at(11, 9)),
    ],
    day,
  );
  expect(placed.map((p) => [p.entry.id, p.startMinute, p.endMinute])).toEqual([
    [1, 0, 60],
    [2, 1380, 1440],
  ]);
});

test("all-day entries are listed separately, on each day they cover", () => {
  const span = entry(1, at(10, 0), at(12, 0), true);
  expect(placeDay([span], day)).toHaveLength(0);
  expect(allDayEntries([span], day)).toHaveLength(1);
  expect(allDayEntries([span], new Date(2026, 10, 11))).toHaveLength(1);
  expect(allDayEntries([span], new Date(2026, 10, 12))).toHaveLength(0);
});

test("weeks start on Monday and local ISO strings round-trip", () => {
  expect(startOfWeek(new Date(2026, 10, 15, 13)).getDate()).toBe(9); // a Sunday
  expect(startOfWeek(new Date(2026, 10, 9, 0)).getDate()).toBe(9); // a Monday
  const moment = new Date(2026, 10, 10, 9, 30, 15);
  expect(toLocalIso(moment)).toMatch(/^2026-11-10T09:30:15[+-]\d{2}:\d{2}$/);
  expect(new Date(toLocalIso(moment)).getTime()).toBe(moment.getTime());
});
