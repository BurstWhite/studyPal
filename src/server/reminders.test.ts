import { expect, test } from "bun:test";
import {
  describeLead,
  effectiveReminders,
  parseReminders,
  readReminders,
  ReminderError,
} from "./reminders";

test("lead times are validated, de-duplicated and ordered longest first", () => {
  expect(parseReminders([30, 1440, 30, 0])).toEqual([1440, 30, 0]);
  expect(parseReminders([])).toEqual([]);
  expect(() => parseReminders("30")).toThrow(ReminderError);
  expect(() => parseReminders([-1])).toThrow(ReminderError);
  expect(() => parseReminders([0.5])).toThrow(ReminderError);
  expect(() => parseReminders([40321])).toThrow(ReminderError);
  expect(() => parseReminders([1, 2, 3, 4, 5, 6])).toThrow("最多");
});

test("stored reminders that cannot be read count as none", () => {
  expect(readReminders(null)).toEqual([]);
  expect(readReminders("[60, 10]")).toEqual([60, 10]);
  expect(readReminders("not json")).toEqual([]);
  expect(readReminders('{"a":1}')).toEqual([]);
});

test("built-in and user-set reminders combine without duplicates", () => {
  expect(effectiveReminders([2880, 1440], null)).toEqual([2880, 1440]);
  expect(effectiveReminders([2880, 1440], "[60, 1440, 4320]")).toEqual([
    4320, 2880, 1440, 60,
  ]);
  expect(effectiveReminders([], "[15]")).toEqual([15]);
  expect(effectiveReminders([], null)).toEqual([]);
});

test("describes lead times in words", () => {
  expect(describeLead(0)).toBe("准时");
  expect(describeLead(30)).toBe("提前 30 分钟");
  expect(describeLead(90)).toBe("提前 1 小时 30 分钟");
  expect(describeLead(1440)).toBe("提前 1 天");
  expect(describeLead(2940)).toBe("提前 2 天 1 小时");
});
