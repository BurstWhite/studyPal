/** Date helpers for the calendar UI. Everything works in the browser's zone. */

const pad = (value: number) => String(value).padStart(2, "0");

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Monday of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** `YYYY-MM-DD` in local time, the value format of `<input type="date">`. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
export function toDateTimeInput(date: Date): string {
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO 8601 with the local UTC offset, e.g. `2026-11-10T09:00:00+08:00`. */
export function toLocalIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${toDateTimeInput(date)}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Parses a `YYYY-MM-DD` input value as local midnight. */
export function fromDateInput(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(+match[1]!, +match[2]! - 1, +match[3]!);
}

/** Parses a `YYYY-MM-DDTHH:mm` input value as local time. */
export function fromDateTimeInput(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  return new Date(
    +match[1]!,
    +match[2]! - 1,
    +match[3]!,
    +match[4]!,
    +match[5]!,
  );
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function weekdayLabel(date: Date): string {
  return WEEKDAYS[date.getDay()]!;
}

export function formatRange(weekStart: Date): string {
  const last = addDays(weekStart, 6);
  const head = `${weekStart.getFullYear()} 年 ${weekStart.getMonth() + 1} 月 ${weekStart.getDate()} 日`;
  const tail =
    last.getMonth() === weekStart.getMonth()
      ? `${last.getDate()} 日`
      : `${last.getMonth() + 1} 月 ${last.getDate()} 日`;
  return `${head} – ${tail}`;
}
