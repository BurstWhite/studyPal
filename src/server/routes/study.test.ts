import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db";
import {
  BlockInputError,
  listBlocks,
  parseBlockChange,
  readProgress,
  updateBlock,
  weekStart,
} from "./study";

const at = (iso: string) => new Date(iso);
// A Tuesday.
const NOW = at("2026-11-10T09:00:00+08:00");

function seed() {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO assignments (id, course, title, due_at, status) VALUES
      (1, '数据结构', '实验三', '2026-11-12T23:59:00+08:00', 'open'),
      (2, '数据结构', '实验二', '2026-11-08T23:59:00+08:00', 'open'),
      (3, '大学物理', '第七章习题', '2026-11-30T23:59:00+08:00', 'open'),
      (4, '大学物理', '第六章习题', '2026-11-01T23:59:00+08:00', 'done'),
      (5, NULL, '读论文', NULL, 'open');
    INSERT INTO study_blocks (id, assignment_id, title, starts_at, ends_at, estimated_minutes, done) VALUES
      (1, 1, '写实验三（上）', '2026-11-09T19:00:00+08:00', '2026-11-09T21:00:00+08:00', 120, 1),
      (2, 1, '写实验三（下）', '2026-11-11T19:00:00+08:00', '2026-11-11T20:30:00+08:00', 90, 0),
      (3, 3, '物理习题', '2026-11-17T19:00:00+08:00', '2026-11-17T20:00:00+08:00', 60, 0),
      (4, NULL, '背单词', '2026-11-15T22:00:00+08:00', '2026-11-15T22:30:00+08:00', 30, 0);
  `);
  return db;
}

describe("study blocks", () => {
  test("lists blocks overlapping a range, with their assignment", () => {
    const blocks = listBlocks(
      seed(),
      at("2026-11-09T00:00:00+08:00"),
      at("2026-11-16T00:00:00+08:00"),
    );
    expect(blocks.map((block) => block.id)).toEqual([1, 2, 4]);
    expect(blocks[0]).toEqual({
      id: 1,
      assignmentId: 1,
      assignmentTitle: "实验三",
      course: "数据结构",
      title: "写实验三（上）",
      start: "2026-11-09T11:00:00.000Z",
      end: "2026-11-09T13:00:00.000Z",
      minutes: 120,
      done: true,
    });
    expect(blocks[2]).toMatchObject({
      assignmentId: null,
      assignmentTitle: null,
      course: null,
    });
  });

  test("validates changes", () => {
    expect(parseBlockChange({ done: true })).toEqual({ done: true });
    expect(parseBlockChange({ title: " 新标题 " })).toEqual({
      title: "新标题",
    });
    expect(() => parseBlockChange({})).toThrow(BlockInputError);
    expect(() => parseBlockChange({ done: "yes" })).toThrow(BlockInputError);
    expect(() => parseBlockChange({ title: " " })).toThrow(BlockInputError);
    expect(() =>
      parseBlockChange({ startsAt: "2026-11-11T19:00:00+08:00" }),
    ).toThrow(BlockInputError);
    expect(() =>
      parseBlockChange({
        startsAt: "2026-11-11T20:00:00+08:00",
        endsAt: "2026-11-11T19:00:00+08:00",
      }),
    ).toThrow("晚于");
  });

  test("marks done with a timestamp, clears it again, and moves a block", () => {
    const db = seed();
    expect(updateBlock(db, 2, { done: true }, NOW)).toBe(true);
    expect(
      db.query("SELECT done, done_at FROM study_blocks WHERE id = 2").get(),
    ).toEqual({
      done: 1,
      done_at: NOW.toISOString(),
    });
    updateBlock(db, 2, { done: false });
    expect(
      db.query("SELECT done, done_at FROM study_blocks WHERE id = 2").get(),
    ).toEqual({ done: 0, done_at: null });

    updateBlock(db, 2, {
      startsAt: "2026-11-12T10:00:00+08:00",
      endsAt: "2026-11-12T10:45:00+08:00",
    });
    expect(
      db
        .query(
          "SELECT starts_at, estimated_minutes FROM study_blocks WHERE id = 2",
        )
        .get(),
    ).toEqual({
      starts_at: "2026-11-12T10:00:00+08:00",
      estimated_minutes: 45,
    });
    expect(updateBlock(db, 99, { done: true })).toBe(false);
  });
});

describe("progress", () => {
  test("weeks start on Monday, Beijing time", () => {
    expect(weekStart(NOW).toISOString()).toBe("2026-11-08T16:00:00.000Z");
    // Sunday 23:59 still belongs to the week that began the previous Monday.
    expect(weekStart(at("2026-11-15T23:59:00+08:00")).toISOString()).toBe(
      "2026-11-08T16:00:00.000Z",
    );
    expect(weekStart(at("2026-11-16T00:00:00+08:00")).toISOString()).toBe(
      "2026-11-15T16:00:00.000Z",
    );
  });

  test("summarises this week's blocks", () => {
    expect(readProgress(seed(), NOW).week).toEqual({
      start: "2026-11-08T16:00:00.000Z",
      blocks: 3,
      blocksDone: 1,
      minutes: 240,
      minutesDone: 120,
    });
  });

  test("groups by course and separates overdue from upcoming", () => {
    const progress = readProgress(seed(), NOW);
    expect(progress.courses).toEqual([
      { course: "数据结构", openAssignments: 2, blocks: 2, blocksDone: 1 },
      { course: "大学物理", openAssignments: 1, blocks: 1, blocksDone: 0 },
      { course: "未归类", openAssignments: 1, blocks: 0, blocksDone: 0 },
    ]);
    expect(progress.overdue.map((a) => a.title)).toEqual(["实验二"]);
    // Due within seven days; the one due on the 30th is not listed.
    expect(progress.upcoming).toEqual([
      {
        id: 1,
        course: "数据结构",
        title: "实验三",
        dueAt: "2026-11-12T15:59:00.000Z",
        blocks: 2,
        blocksDone: 1,
      },
    ]);
  });

  test("an empty database gives zeros, not errors", () => {
    const progress = readProgress(openDatabase(":memory:"), NOW);
    expect(progress.week).toMatchObject({
      blocks: 0,
      blocksDone: 0,
      minutes: 0,
    });
    expect(progress.courses).toEqual([]);
    expect(progress.overdue).toEqual([]);
  });
});
