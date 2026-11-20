/**
 * The subset of RFC 5545 recurrence rules studyPal creates and understands:
 * `FREQ=DAILY|WEEKLY` with optional `INTERVAL`, `UNTIL` and `COUNT`.
 *
 * Occurrences are spaced by exact multiples of 24 hours. That keeps the wall
 * clock time stable in zones without daylight saving (the app targets
 * Asia/Shanghai) and matches how the ICS export writes the same rule in UTC.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Rule {
  freq: "DAILY" | "WEEKLY";
  interval: number;
  /** Last instant (inclusive) at which an occurrence may start. */
  until?: Date;
  count?: number;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

function parseUntil(value: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(
    value,
  );
  if (!match) throw new Error(`Unsupported UNTIL value: ${value}`);
  const [, y, mo, d, h = "23", mi = "59", s = "59"] = match;
  return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s));
}

export function formatUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function parseRule(rrule: string): Rule {
  const parts = new Map<string, string>();
  for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = part.split("=");
    if (!key || value === undefined)
      throw new Error(`Malformed rule: ${rrule}`);
    parts.set(key.toUpperCase(), value);
  }

  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY") {
    throw new Error(`Unsupported FREQ: ${freq ?? "(missing)"}`);
  }
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error(`Invalid INTERVAL: ${parts.get("INTERVAL")}`);
  }
  const rule: Rule = { freq, interval };

  const until = parts.get("UNTIL");
  if (until !== undefined) rule.until = parseUntil(until);

  const count = parts.get("COUNT");
  if (count !== undefined) {
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Invalid COUNT: ${count}`);
    }
    rule.count = parsed;
  }

  for (const key of parts.keys()) {
    if (!["FREQ", "INTERVAL", "UNTIL", "COUNT"].includes(key)) {
      throw new Error(`Unsupported rule part: ${key}`);
    }
  }
  return rule;
}

export function formatRule(rule: Rule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.until) parts.push(`UNTIL=${formatUtc(rule.until)}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

/**
 * Occurrences of an event that overlap the half-open range `[from, to)`.
 * A non-recurring event (`rrule` null) yields itself when it overlaps.
 */
export function expand(
  start: Date,
  end: Date,
  rrule: string | null,
  from: Date,
  to: Date,
): Occurrence[] {
  const duration = end.getTime() - start.getTime();
  const overlaps = (s: number) =>
    s < to.getTime() && s + duration > from.getTime();

  if (!rrule) {
    return overlaps(start.getTime()) ? [{ start, end }] : [];
  }

  const rule = parseRule(rrule);
  const step = (rule.freq === "WEEKLY" ? 7 : 1) * rule.interval * DAY_MS;
  // Skip straight to the first occurrence that can still overlap the range.
  const first = Math.max(
    0,
    Math.ceil((from.getTime() - duration - start.getTime()) / step),
  );

  const result: Occurrence[] = [];
  for (let index = first; ; index++) {
    const s = start.getTime() + index * step;
    if (s >= to.getTime()) break;
    if (rule.count !== undefined && index >= rule.count) break;
    if (rule.until && s > rule.until.getTime()) break;
    if (overlaps(s)) {
      result.push({ start: new Date(s), end: new Date(s + duration) });
    }
  }
  return result;
}
