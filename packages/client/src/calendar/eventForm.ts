/** The event editor's rules, shared by both apps. */
import { addDays, toLocalIso } from "./dates";

export type Repeat = "none" | "daily" | "weekly" | "biweekly";

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: "不重复",
  daily: "每天",
  weekly: "每周",
  biweekly: "每两周",
};

const REPEAT_RULES: Record<Exclude<Repeat, "none">, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
};

/** How an event repeats, and the instant its repetition ends (if it does). */
export function readRepeat(rrule: string | null): {
  repeat: Repeat;
  until: Date | null;
} {
  if (!rrule) return { repeat: "none", until: null };
  const interval = /INTERVAL=(\d+)/.exec(rrule)?.[1] ?? "1";
  const repeat: Repeat = rrule.includes("FREQ=DAILY")
    ? "daily"
    : interval === "2"
      ? "biweekly"
      : "weekly";
  const match = /UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(
    rrule,
  );
  if (!match) return { repeat, until: null };
  const [, y, mo, d, h, mi, s] = match;
  return {
    repeat,
    until: new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!)),
  };
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export interface EventDraft {
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  /** For all-day events, local midnight of the first and of the last day. */
  start: Date;
  end: Date;
  repeat: Repeat;
  /** Local midnight of the last day the event repeats on, or null for no end. */
  lastDay: Date | null;
}

/** The request body for saving `draft`, or a message to show instead. */
export function eventRequestBody(
  draft: EventDraft,
): { body: object } | { problem: string } {
  if (!draft.title.trim()) return { problem: "请填写标题" };
  const start = draft.start;
  // All-day events are stored with an exclusive end.
  const end = draft.allDay ? addDays(draft.end, 1) : draft.end;
  if (end <= start) return { problem: "结束时间必须晚于开始时间" };

  let rrule: string | null = null;
  if (draft.repeat !== "none") {
    rrule = REPEAT_RULES[draft.repeat];
    if (draft.lastDay) {
      const until = new Date(addDays(draft.lastDay, 1).getTime() - 1000);
      if (until < start) return { problem: "重复截止日期不能早于开始时间" };
      rrule += `;UNTIL=${utcStamp(until)}`;
    }
  }

  return {
    body: {
      title: draft.title,
      location: draft.location,
      notes: draft.notes,
      allDay: draft.allDay,
      startsAt: toLocalIso(start),
      endsAt: toLocalIso(end),
      rrule,
    },
  };
}
