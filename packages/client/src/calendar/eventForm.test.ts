import { expect, test } from "bun:test";
import { eventRequestBody, readRepeat } from "./eventForm";

const local = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(y, m - 1, d, h, mi);

test("a repeating event round-trips through its rule", () => {
  const result = eventRequestBody({
    title: "高数习题课",
    location: "",
    notes: "",
    allDay: false,
    start: local(2026, 11, 19, 19),
    end: local(2026, 11, 19, 20, 30),
    repeat: "biweekly",
    lastDay: local(2026, 12, 31),
  });
  if (!("body" in result)) throw new Error(result.problem);
  const body = result.body as { rrule: string; allDay: boolean };
  expect(body.rrule).toStartWith("FREQ=WEEKLY;INTERVAL=2;UNTIL=");
  const read = readRepeat(body.rrule);
  expect(read.repeat).toBe("biweekly");
  // The repetition runs through the end of the last day.
  expect(read.until!.getTime()).toBe(local(2027, 1, 1).getTime() - 1000);
});

test("all-day events end the day after their last day", () => {
  const result = eventRequestBody({
    title: "运动会",
    location: "",
    notes: "",
    allDay: true,
    start: local(2026, 11, 20),
    end: local(2026, 11, 21),
    repeat: "none",
    lastDay: null,
  });
  if (!("body" in result)) throw new Error(result.problem);
  const body = result.body as { startsAt: string; endsAt: string; rrule: null };
  expect(new Date(body.endsAt).getTime()).toBe(local(2026, 11, 22).getTime());
  expect(body.rrule).toBeNull();
});

test("problems are reported instead of a body", () => {
  const base = {
    title: "x",
    location: "",
    notes: "",
    allDay: false,
    start: local(2026, 11, 19, 10),
    end: local(2026, 11, 19, 9),
    repeat: "none" as const,
    lastDay: null,
  };
  expect(eventRequestBody({ ...base, title: " " })).toEqual({
    problem: "请填写标题",
  });
  expect(eventRequestBody(base)).toEqual({
    problem: "结束时间必须晚于开始时间",
  });
  expect(
    eventRequestBody({
      ...base,
      end: local(2026, 11, 19, 11),
      repeat: "daily",
      lastDay: local(2026, 11, 18),
    }),
  ).toEqual({ problem: "重复截止日期不能早于开始时间" });
});
