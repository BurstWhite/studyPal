import { expect, test } from "bun:test";
import { summarizeTool } from "./toolSummary";

test("approval cards spell out the reminders being set", () => {
  expect(
    summarizeTool("set_reminders", {
      target: "assignment",
      id: 3,
      minutes_before: [1440, 90],
    }),
  ).toEqual({
    label: "给作业设置提醒",
    lines: ["作业 #3", "提醒：提前 1 天、提前 1 小时 30 分钟"],
  });
  expect(
    summarizeTool("set_reminders", {
      target: "event",
      id: 7,
      minutes_before: [],
    }),
  ).toEqual({ label: "取消日程的提醒", lines: ["日程 #7"] });
});

test("new events and study blocks show their reminders", () => {
  const event = summarizeTool("create_event", {
    title: "答疑",
    starts_at: "2026-11-12T16:00:00+08:00",
    ends_at: "2026-11-12T17:00:00+08:00",
    reminders_minutes_before: [30],
  });
  expect(event.label).toBe("添加日程");
  expect(event.lines.at(-1)).toBe("提醒：提前 30 分钟");
  expect(event.lines[0]).toStartWith("答疑 · ");

  const blocks = summarizeTool("create_study_blocks", {
    blocks: [
      {
        title: "写实验",
        starts_at: "2026-11-12T19:00:00+08:00",
        ends_at: "2026-11-12T20:00:00+08:00",
        reminders_minutes_before: [0],
      },
      {
        title: "复习",
        starts_at: "2026-11-13T19:00:00+08:00",
        ends_at: "2026-11-13T20:00:00+08:00",
      },
    ],
  });
  expect(blocks.lines[0]).toEndWith(" · 提醒：准时");
  expect(blocks.lines[1]).not.toContain("提醒");
});

test("an event without reminders has no reminder line", () => {
  const event = summarizeTool("create_event", {
    title: "组会",
    starts_at: "2026-11-12T14:00:00+08:00",
    ends_at: "2026-11-12T15:00:00+08:00",
  });
  expect(event.lines).toHaveLength(1);
});
