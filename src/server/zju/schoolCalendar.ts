/**
 * Turns weekly timetable slots into dated classes using the term calendar:
 * term halves, period times, holidays and swapped working days.
 *
 * The calendar data is published per term by the Celechron project at
 * calendar.celechron.top; ZJU itself offers no machine-readable calendar.
 */
import type { FetchLike } from "./http";
import type { TimetableSlot } from "./zdbk";

const CALENDAR_BASE = "http://calendar.celechron.top/";
/** All class times are Beijing time. */
const ZONE_OFFSET = "+08:00";
const DAY_MS = 86_400_000;

export interface SchoolCalendar {
  /** `periods[n]` is the `[start, end]` of class period n as `HH:MM`; index 0 is unused. */
  periods: [string, string][];
  /** First and second half of the term; dates are `YYYY-MM-DD`, inclusive. */
  halves: [{ start: string; end: string }, { start: string; end: string }];
  /** Days with no classes and no make-up day. */
  holidays: Set<string>;
  /** Days whose classes move to another day, in both directions. */
  swaps: Map<string, string>;
}

export interface ClassOccurrence {
  date: string;
  /** ISO 8601 with offset. */
  startsAt: string;
  endsAt: string;
}

function isoDate(compact: string): string {
  if (!/^\d{8}$/.test(compact)) throw new Error(`校历日期格式无效：${compact}`);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

export function parseSchoolCalendar(raw: unknown): SchoolCalendar {
  const config = raw as {
    sessionTime?: unknown;
    startEnd?: unknown;
    holiday?: Record<string, unknown>;
    exchange?: Record<string, unknown>;
  } | null;

  const startEnd = config?.startEnd;
  if (!Array.isArray(startEnd) || startEnd.length !== 4) {
    throw new Error("校历缺少四个学期起止日期");
  }
  const [firstStart, firstEnd, secondStart, secondEnd] = startEnd.map((value) =>
    isoDate(String(value)),
  ) as [string, string, string, string];

  const sessionTime = config?.sessionTime;
  if (!Array.isArray(sessionTime) || sessionTime.length < 2) {
    throw new Error("校历缺少节次时间");
  }
  const periods = sessionTime.map((pair) => {
    const [start, end] = Array.isArray(pair) ? pair : [];
    if (
      !/^\d{2}:\d{2}$/.test(String(start)) ||
      !/^\d{2}:\d{2}$/.test(String(end))
    ) {
      throw new Error("校历节次时间格式无效");
    }
    return [String(start), String(end)] as [string, string];
  });

  const holidays = new Set(Object.keys(config?.holiday ?? {}).map(isoDate));
  const swaps = new Map<string, string>();
  for (const key of Object.keys(config?.exchange ?? {})) {
    if (!/^\d{16}$/.test(key)) continue;
    const first = isoDate(key.slice(0, 8));
    const second = isoDate(key.slice(8, 16));
    swaps.set(first, second);
    swaps.set(second, first);
  }

  return {
    periods,
    halves: [
      { start: firstStart, end: firstEnd },
      { start: secondStart, end: secondEnd },
    ],
    holidays,
    swaps,
  };
}

/** `termId` looks like `2026-2027-1`. Returns undefined when not published yet. */
export async function fetchSchoolCalendar(
  termId: string,
  fetchImpl: FetchLike = fetch,
): Promise<SchoolCalendar | undefined> {
  if (!/^\d{4}-\d{4}-[12]$/.test(termId))
    throw new Error(`无效的学年学期：${termId}`);
  const response = await fetchImpl(`${CALENDAR_BASE}${termId}.json`, {
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (response.status === 404 || body.includes("<Code>NoSuchKey</Code>"))
    return undefined;
  if (!response.ok) throw new Error(`校历接口返回 HTTP ${response.status}`);
  return parseSchoolCalendar(JSON.parse(body));
}

const toDays = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const fromDays = (days: number) =>
  new Date(days * DAY_MS).toISOString().slice(0, 10);
/** 1 = Monday … 7 = Sunday. */
const weekday = (days: number) =>
  ((new Date(days * DAY_MS).getUTCDay() + 6) % 7) + 1;

/**
 * Every date a slot meets on. Week parity restarts at "odd" in each half of
 * the term and flips every Monday.
 */
export function expandSlot(
  slot: TimetableSlot,
  calendar: SchoolCalendar,
): ClassOccurrence[] {
  const first = calendar.periods[slot.firstPeriod];
  const last = calendar.periods[slot.firstPeriod + slot.periodCount - 1];
  if (!first || !last) return [];

  const dates: string[] = [];
  const halves = [
    slot.firstHalf ? calendar.halves[0] : undefined,
    slot.secondHalf ? calendar.halves[1] : undefined,
  ];
  for (const half of halves) {
    if (!half) continue;
    let odd = true;
    for (let day = toDays(half.start); day <= toDays(half.end); day++) {
      if (day !== toDays(half.start) && weekday(day) === 1) odd = !odd;
      if (weekday(day) !== slot.dayOfWeek) continue;
      if (odd ? slot.oddWeeks : slot.evenWeeks) dates.push(fromDays(day));
    }
  }

  return dates
    .filter((date) => !calendar.holidays.has(date))
    .map((date) => calendar.swaps.get(date) ?? date)
    .sort()
    .map((date) => ({
      date,
      startsAt: `${date}T${first[0]}:00${ZONE_OFFSET}`,
      endsAt: `${date}T${last[1]}:00${ZONE_OFFSET}`,
    }));
}

/** The academic year (`2026-2027`) that `now` falls in; it turns over in September. */
export function academicYearOf(now: Date): string {
  // Decide in Beijing time so the boundary does not depend on the machine's zone.
  const local = new Date(now.getTime() + 8 * 3_600_000);
  const start =
    local.getUTCMonth() >= 8
      ? local.getUTCFullYear()
      : local.getUTCFullYear() - 1;
  return `${start}-${start + 1}`;
}

/** Periods further apart than this are separate sittings (lunch, dinner). */
const MAX_BREAK_MINUTES = 20;

const minutesOf = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/**
 * Joins slots the academic system reports separately although they are one
 * sitting of the same course: for example period 6 on its own followed by
 * periods 7–8, same room, same weeks. Slots separated by more than a short
 * break stay apart, so a morning class never fuses with an afternoon one.
 */
export function joinAdjacentSlots(
  slots: TimetableSlot[],
  calendar: SchoolCalendar,
): TimetableSlot[] {
  const sameSitting = (a: TimetableSlot, b: TimetableSlot) =>
    a.name === b.name &&
    a.dayOfWeek === b.dayOfWeek &&
    a.location === b.location &&
    a.teacher === b.teacher &&
    a.oddWeeks === b.oddWeeks &&
    a.evenWeeks === b.evenWeeks &&
    a.firstHalf === b.firstHalf &&
    a.secondHalf === b.secondHalf;

  const sorted = slots
    .map((slot) => ({ ...slot }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.firstPeriod - b.firstPeriod);

  const joined: TimetableSlot[] = [];
  for (const slot of sorted) {
    // The earlier slot of the same sitting that ends right where this starts.
    const previous = joined.find(
      (candidate) =>
        sameSitting(candidate, slot) &&
        candidate.firstPeriod + candidate.periodCount === slot.firstPeriod,
    );
    const lastPeriod = previous
      ? calendar.periods[previous.firstPeriod + previous.periodCount - 1]
      : undefined;
    const nextPeriod = calendar.periods[slot.firstPeriod];
    if (
      previous &&
      lastPeriod &&
      nextPeriod &&
      minutesOf(nextPeriod[0]) - minutesOf(lastPeriod[1]) <= MAX_BREAK_MINUTES
    ) {
      previous.periodCount += slot.periodCount;
    } else {
      joined.push(slot);
    }
  }
  return joined;
}
