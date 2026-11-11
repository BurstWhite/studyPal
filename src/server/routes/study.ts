/** Study blocks and the progress overview built from them. */
import type { Database } from "bun:sqlite";
import { guarded } from "../auth";
import { scheduleSystemCalendarPush } from "../calendar/system";
import { getDb } from "../db";

export interface StudyBlock {
  id: number;
  assignmentId: number | null;
  /** Title of the assignment it belongs to, if any. */
  assignmentTitle: string | null;
  course: string | null;
  title: string;
  /** ISO 8601 instants. */
  start: string;
  end: string;
  minutes: number;
  done: boolean;
}

interface BlockRow {
  id: number;
  assignment_id: number | null;
  assignment_title: string | null;
  course: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  estimated_minutes: number;
  done: number;
}

const BLOCK_SELECT = `
  SELECT b.id, b.assignment_id, a.title AS assignment_title, a.course, b.title,
         b.starts_at, b.ends_at, b.estimated_minutes, b.done
  FROM study_blocks b LEFT JOIN assignments a ON a.id = b.assignment_id`;

const toBlock = (row: BlockRow): StudyBlock => ({
  id: row.id,
  assignmentId: row.assignment_id,
  assignmentTitle: row.assignment_title,
  course: row.course,
  title: row.title,
  start: new Date(row.starts_at).toISOString(),
  end: new Date(row.ends_at).toISOString(),
  minutes: row.estimated_minutes,
  done: row.done === 1,
});

/** Blocks overlapping `[from, to)`, by start time. */
export function listBlocks(db: Database, from: Date, to: Date): StudyBlock[] {
  // Stored times carry offsets, so overlap is checked on parsed instants.
  return (db.query(BLOCK_SELECT).all() as BlockRow[])
    .map(toBlock)
    .filter((block) => new Date(block.start) < to && new Date(block.end) > from)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface BlockChange {
  done?: boolean;
  title?: string;
  startsAt?: string;
  endsAt?: string;
}

export class BlockInputError extends Error {}

export function parseBlockChange(body: unknown): BlockChange {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const change: BlockChange = {};
  if (raw.done !== undefined) {
    if (typeof raw.done !== "boolean")
      throw new BlockInputError("done 必须是布尔值");
    change.done = raw.done;
  }
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string" || !raw.title.trim())
      throw new BlockInputError("标题不能为空");
    change.title = raw.title.trim();
  }
  if (raw.startsAt !== undefined || raw.endsAt !== undefined) {
    const start = new Date(String(raw.startsAt));
    const end = new Date(String(raw.endsAt));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BlockInputError("需要同时提供有效的开始和结束时间");
    }
    if (end <= start) throw new BlockInputError("结束时间必须晚于开始时间");
    change.startsAt = String(raw.startsAt);
    change.endsAt = String(raw.endsAt);
  }
  if (Object.keys(change).length === 0)
    throw new BlockInputError("没有要修改的内容");
  return change;
}

/** Applies a change; returns false when the block does not exist. */
export function updateBlock(
  db: Database,
  id: number,
  change: BlockChange,
  now = new Date(),
): boolean {
  if (!db.query("SELECT 1 FROM study_blocks WHERE id = ?").get(id))
    return false;
  db.transaction(() => {
    if (change.done !== undefined) {
      db.query(
        "UPDATE study_blocks SET done = ?, done_at = ? WHERE id = ?",
      ).run(change.done ? 1 : 0, change.done ? now.toISOString() : null, id);
    }
    if (change.title !== undefined) {
      db.query("UPDATE study_blocks SET title = ? WHERE id = ?").run(
        change.title,
        id,
      );
    }
    if (change.startsAt !== undefined && change.endsAt !== undefined) {
      const minutes = Math.round(
        (new Date(change.endsAt).getTime() -
          new Date(change.startsAt).getTime()) /
          60_000,
      );
      db.query(
        "UPDATE study_blocks SET starts_at = ?, ends_at = ?, estimated_minutes = ? WHERE id = ?",
      ).run(change.startsAt, change.endsAt, minutes, id);
    }
  })();
  return true;
}

export interface CourseProgress {
  course: string;
  openAssignments: number;
  blocks: number;
  blocksDone: number;
}

export interface ProgressAssignment {
  id: number;
  course: string | null;
  title: string;
  dueAt: string;
  /** Study blocks planned for it, and how many are finished. */
  blocks: number;
  blocksDone: number;
}

export interface Progress {
  /** Study blocks that start within the current week (Monday to Sunday, Beijing time). */
  week: {
    start: string;
    blocks: number;
    blocksDone: number;
    minutes: number;
    minutesDone: number;
  };
  courses: CourseProgress[];
  /** Open assignments past their deadline. */
  overdue: ProgressAssignment[];
  /** Open assignments due within the next seven days. */
  upcoming: ProgressAssignment[];
}

const DAY_MS = 86_400_000;
const ZONE_OFFSET_MS = 8 * 3_600_000;

/** Monday 00:00 Beijing time of the week containing `now`. */
export function weekStart(now: Date): Date {
  const local = now.getTime() + ZONE_OFFSET_MS;
  const day = Math.floor(local / DAY_MS);
  // 1970-01-01 was a Thursday, so day 4 was the first Monday.
  const monday = day - ((((day - 4) % 7) + 7) % 7);
  return new Date(monday * DAY_MS - ZONE_OFFSET_MS);
}

export function readProgress(db: Database, now = new Date()): Progress {
  const start = weekStart(now);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const blocks = (db.query(BLOCK_SELECT).all() as BlockRow[]).map(toBlock);

  const thisWeek = blocks.filter((block) => {
    const at = new Date(block.start);
    return at >= start && at < end;
  });
  const done = thisWeek.filter((block) => block.done);
  const sum = (list: StudyBlock[]) =>
    list.reduce((total, block) => total + block.minutes, 0);

  const assignments = db
    .query(
      "SELECT id, course, title, due_at FROM assignments WHERE status = 'open' ORDER BY due_at, id",
    )
    .all() as {
    id: number;
    course: string | null;
    title: string;
    due_at: string | null;
  }[];

  const perAssignment = new Map<
    number,
    { blocks: number; blocksDone: number }
  >();
  for (const block of blocks) {
    if (block.assignmentId === null) continue;
    const entry = perAssignment.get(block.assignmentId) ?? {
      blocks: 0,
      blocksDone: 0,
    };
    entry.blocks++;
    if (block.done) entry.blocksDone++;
    perAssignment.set(block.assignmentId, entry);
  }

  const courses = new Map<string, CourseProgress>();
  const courseOf = (name: string | null) => {
    const course = name ?? "未归类";
    let entry = courses.get(course);
    if (!entry)
      courses.set(
        course,
        (entry = { course, openAssignments: 0, blocks: 0, blocksDone: 0 }),
      );
    return entry;
  };
  for (const assignment of assignments)
    courseOf(assignment.course).openAssignments++;
  for (const block of blocks) {
    // Blocks not tied to an assignment have no course to count under.
    if (block.assignmentId === null) continue;
    const entry = courseOf(block.course);
    entry.blocks++;
    if (block.done) entry.blocksDone++;
  }

  const dated = assignments
    .filter((assignment) => assignment.due_at !== null)
    .map((assignment) => ({
      id: assignment.id,
      course: assignment.course,
      title: assignment.title,
      dueAt: new Date(assignment.due_at!).toISOString(),
      ...(perAssignment.get(assignment.id) ?? { blocks: 0, blocksDone: 0 }),
    }));
  const soon = new Date(now.getTime() + 7 * DAY_MS);

  return {
    week: {
      start: start.toISOString(),
      blocks: thisWeek.length,
      blocksDone: done.length,
      minutes: sum(thisWeek),
      minutesDone: sum(done),
    },
    courses: [...courses.values()].sort(
      (a, b) =>
        b.openAssignments - a.openAssignments ||
        a.course.localeCompare(b.course, "zh-CN"),
    ),
    overdue: dated.filter((assignment) => new Date(assignment.dueAt) <= now),
    upcoming: dated.filter((assignment) => {
      const due = new Date(assignment.dueAt);
      return due > now && due <= soon;
    }),
  };
}

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

type BlockRequest = Bun.BunRequest<"/api/study-blocks/:id">;
const parseId = (req: BlockRequest) =>
  /^\d+$/.test(req.params.id) ? Number(req.params.id) : undefined;

export const studyRoutes = {
  "/api/study-blocks": {
    GET: guarded((req: Request) => {
      const params = new URL(req.url).searchParams;
      const from = new Date(params.get("from") ?? "");
      const to = new Date(params.get("to") ?? "");
      if (
        Number.isNaN(from.getTime()) ||
        Number.isNaN(to.getTime()) ||
        to <= from
      ) {
        return bad("需要有效的 from 和 to 时间参数");
      }
      return Response.json(listBlocks(getDb(), from, to));
    }),
  },

  "/api/study-blocks/:id": {
    PATCH: guarded(async (req: BlockRequest) => {
      const id = parseId(req);
      if (id === undefined) return bad("无效的学习块编号");
      try {
        const change = parseBlockChange(await req.json().catch(() => null));
        if (!updateBlock(getDb(), id, change)) return bad("学习块不存在", 404);
      } catch (error) {
        if (error instanceof BlockInputError) return bad(error.message);
        throw error;
      }
      scheduleSystemCalendarPush(getDb());
      return Response.json({ ok: true });
    }),
    DELETE: guarded((req: BlockRequest) => {
      const id = parseId(req);
      if (id === undefined) return bad("无效的学习块编号");
      const result = getDb()
        .query("DELETE FROM study_blocks WHERE id = ?")
        .run(id);
      if (result.changes === 0) return bad("学习块不存在", 404);
      scheduleSystemCalendarPush(getDb());
      return Response.json({ ok: true });
    }),
  },

  "/api/progress": {
    GET: guarded(() => Response.json(readProgress(getDb()))),
  },
};
