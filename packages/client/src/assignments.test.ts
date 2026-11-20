import { expect, test } from "bun:test";
import {
  assignmentLists,
  describeRemaining,
  matchesQuery,
} from "./assignments";

const NOW = new Date("2026-11-18T12:00:00+08:00").getTime();
const item = (title: string, dueAt: string | null, status = "open") => ({
  title,
  course: "数据结构",
  dueAt,
  status: status as "open" | "done" | "dismissed",
});

test("open items are grouped by how soon they are due", () => {
  const lists = assignmentLists(
    [
      item("late", "2026-11-17T23:59:00+08:00"),
      item("soon", "2026-11-20T23:59:00+08:00"),
      item("later", "2026-12-20T23:59:00+08:00"),
      item("none", null),
      item("finished", "2026-11-19T23:59:00+08:00", "done"),
      item("skipped", null, "dismissed"),
    ],
    NOW,
  );
  const titles = (list: { title: string }[]) =>
    list.map((entry) => entry.title);
  expect(titles(lists.overdue)).toEqual(["late"]);
  expect(titles(lists.soon)).toEqual(["soon"]);
  expect(titles(lists.later)).toEqual(["later"]);
  expect(titles(lists.undated)).toEqual(["none"]);
  expect(titles(lists.thisWeek)).toEqual(["late", "soon"]);
  expect(titles(lists.done)).toEqual(["finished"]);
  expect(titles(lists.dismissed)).toEqual(["skipped"]);
});

test("search matches title or course, ignoring case", () => {
  expect(matchesQuery(item("Lab 3", null), "lab")).toBe(true);
  expect(matchesQuery(item("Lab 3", null), "数据")).toBe(true);
  expect(matchesQuery(item("Lab 3", null), "物理")).toBe(false);
  expect(matchesQuery(item("Lab 3", null), "  ")).toBe(true);
});

test("remaining time in words", () => {
  const now = new Date(NOW);
  expect(describeRemaining("2026-11-18T12:30:00+08:00", now)).toEqual({
    text: "还剩 30 分钟",
    urgent: true,
  });
  expect(describeRemaining("2026-11-21T12:00:00+08:00", now).text).toBe(
    "还剩 3 天",
  );
  expect(describeRemaining("2026-11-18T11:00:00+08:00", now).text).toBe(
    "已截止",
  );
});
