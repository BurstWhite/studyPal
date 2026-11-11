/**
 * The tools the chat assistant can use to read and change the schedule.
 * Definitions are plain JSON Schema so both provider adapters can send them.
 */
import type { Database } from "bun:sqlite";
import {
  createEvent,
  listEntries,
  parseEventInput,
  ValidationError,
} from "../calendar/store";
import { freeSlots, toBeijingIso, type Interval } from "../scheduler/slots";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  inputSchema: Record<string, unknown>;
  /** Writes are shown to the user for approval before they run. */
  write: boolean;
}

export interface ToolOutcome {
  /** Text handed back to the model. */
  content: string;
  isError: boolean;
  /** True when the tool changed schedule data. */
  changed: boolean;
}

const MAX_RANGE_DAYS = 62;
const MAX_ROWS = 200;
/** How much of an assignment's description is shown to the model. */
const DESCRIPTION_FOR_MODEL = 1500;

const instantSchema = {
  type: "string",
  description: "ISO 8601 时间，带时区，例如 2026-11-10T19:00:00+08:00",
};

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_events",
    description:
      "列出一段时间内的日程：课程、考试、手动日程和学习块。回答与日程有关的问题或安排时间前先调用。范围最多 62 天。",
    inputSchema: object({ from: instantSchema, to: instantSchema }, [
      "from",
      "to",
    ]),
    write: false,
  },
  {
    name: "list_assignments",
    description:
      "列出作业及截止时间，以及老师写的作业说明和附件名（如果有）。默认只返回未完成的；include_closed 为 true 时也返回已完成和已忽略的。",
    inputSchema: object({ include_closed: { type: "boolean" } }, []),
    write: false,
  },
  {
    name: "find_free_slots",
    description:
      "找出一段时间内没有课程、日程和学习块的空档（每天 8:00–22:00，北京时间）。安排学习块之前调用。范围最多 62 天。",
    inputSchema: object(
      {
        from: instantSchema,
        to: instantSchema,
        min_minutes: {
          type: "integer",
          description: "空档的最短时长，默认 30 分钟",
        },
      },
      ["from", "to"],
    ),
    write: false,
  },
  {
    name: "create_event",
    description: "在日程表里添加一条不重复的日程。用户会先看到并确认。",
    inputSchema: object(
      {
        title: { type: "string" },
        starts_at: instantSchema,
        ends_at: instantSchema,
        location: { type: "string" },
        notes: { type: "string" },
      },
      ["title", "starts_at", "ends_at"],
    ),
    write: true,
  },
  {
    name: "create_study_blocks",
    description:
      "创建一个或多个学习块（为完成某项作业或复习安排的时间段）。尽量放在空档里。用户会先看到并确认。",
    inputSchema: object(
      {
        blocks: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: object(
            {
              title: { type: "string" },
              starts_at: instantSchema,
              ends_at: instantSchema,
              assignment_id: {
                type: "integer",
                description:
                  "这个学习块对应的作业编号（来自 list_assignments），没有就不填",
              },
            },
            ["title", "starts_at", "ends_at"],
          ),
        },
      },
      ["blocks"],
    ),
    write: true,
  },
  {
    name: "set_study_block_done",
    description: "把一个学习块标记为已完成或未完成。用户会先看到并确认。",
    inputSchema: object(
      { id: { type: "integer" }, done: { type: "boolean" } },
      ["id", "done"],
    ),
    write: true,
  },
  {
    name: "delete_study_block",
    description: "删除一个学习块。用户会先看到并确认。",
    inputSchema: object({ id: { type: "integer" } }, ["id"]),
    write: true,
  },
];

class InputError extends Error {}

type Input = Record<string, unknown>;

function asInput(value: unknown): Input {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError("输入必须是一个对象");
  }
  return value as Input;
}

function instant(input: Input, key: string): Date {
  const value = input[key];
  const date = typeof value === "string" ? new Date(value) : undefined;
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    !/[Zz]|[+-]\d{2}:\d{2}$/.test(value as string)
  ) {
    throw new InputError(`${key} 必须是带时区的 ISO 8601 时间`);
  }
  return date;
}

function range(input: Input): { from: Date; to: Date } {
  const from = instant(input, "from");
  const to = instant(input, "to");
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 0) throw new InputError("to 必须晚于 from");
  if (days > MAX_RANGE_DAYS)
    throw new InputError(`时间范围不能超过 ${MAX_RANGE_DAYS} 天`);
  return { from, to };
}

function text(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new InputError(`${key} 不能为空`);
  return value.trim();
}

function integer(input: Input, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new InputError(`${key} 必须是整数`);
  }
  return value;
}

interface BlockRow {
  id: number;
  assignment_id: number | null;
  title: string;
  starts_at: string;
  ends_at: string;
  done: number;
}

function blocksBetween(db: Database, from: Date, to: Date): BlockRow[] {
  const rows = db
    .query(
      "SELECT id, assignment_id, title, starts_at, ends_at, done FROM study_blocks",
    )
    .all() as BlockRow[];
  return rows.filter(
    (row) => new Date(row.starts_at) < to && new Date(row.ends_at) > from,
  );
}

function listEvents(db: Database, input: Input): unknown {
  const { from, to } = range(input);
  const events = listEntries(db, from, to).map((entry) => ({
    kind:
      entry.source === "manual"
        ? "event"
        : entry.source === "exam"
          ? "exam"
          : "class",
    title: entry.title,
    start: toBeijingIso(new Date(entry.start)),
    end: toBeijingIso(new Date(entry.end)),
    all_day: entry.allDay,
    location: entry.location,
  }));
  const blocks = blocksBetween(db, from, to).map((row) => ({
    kind: "study_block",
    id: row.id,
    title: row.title,
    start: toBeijingIso(new Date(row.starts_at)),
    end: toBeijingIso(new Date(row.ends_at)),
    done: row.done === 1,
    assignment_id: row.assignment_id,
  }));
  const all = [...events, ...blocks].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  return { items: all.slice(0, MAX_ROWS), truncated: all.length > MAX_ROWS };
}

function listAssignments(db: Database, input: Input): unknown {
  const includeClosed = input.include_closed === true;
  const rows = db
    .query(
      `SELECT id, course, title, due_at, status, description, attachments FROM assignments
       ${includeClosed ? "" : "WHERE status = 'open'"}
       ORDER BY status != 'open', due_at IS NULL, due_at, id LIMIT ${MAX_ROWS}`,
    )
    .all() as {
    id: number;
    course: string | null;
    title: string;
    due_at: string | null;
    status: string;
    description: string | null;
    attachments: string | null;
  }[];
  return {
    assignments: rows.map((row) => {
      const attachments = row.attachments
        ? (JSON.parse(row.attachments) as string[])
        : [];
      return {
        id: row.id,
        course: row.course,
        title: row.title,
        due: row.due_at ? toBeijingIso(new Date(row.due_at)) : null,
        status: row.status,
        // The teacher's own wording is what makes a workload estimate possible.
        ...(row.description
          ? {
              description:
                row.description.length > DESCRIPTION_FOR_MODEL
                  ? `${row.description.slice(0, DESCRIPTION_FOR_MODEL)}…`
                  : row.description,
            }
          : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
    }),
  };
}

function findFreeSlots(db: Database, input: Input): unknown {
  const { from, to } = range(input);
  const minMinutes =
    input.min_minutes === undefined ? 30 : integer(input, "min_minutes");
  if (minMinutes < 5 || minMinutes > 600)
    throw new InputError("min_minutes 必须在 5 到 600 之间");

  const busy: Interval[] = [
    // All-day entries (a sports day, a holiday marker) do not block time.
    ...listEntries(db, from, to)
      .filter((entry) => !entry.allDay)
      .map((entry) => ({
        start: new Date(entry.start),
        end: new Date(entry.end),
      })),
    ...blocksBetween(db, from, to)
      .filter((row) => row.done === 0)
      .map((row) => ({
        start: new Date(row.starts_at),
        end: new Date(row.ends_at),
      })),
  ];
  const slots = freeSlots(busy, from, to, { minMinutes });
  return {
    slots: slots.slice(0, MAX_ROWS).map((slot) => ({
      start: toBeijingIso(slot.start),
      end: toBeijingIso(slot.end),
      minutes: Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000),
    })),
    truncated: slots.length > MAX_ROWS,
  };
}

function createEventTool(db: Database, input: Input): unknown {
  try {
    const id = createEvent(
      db,
      parseEventInput({
        title: input.title,
        startsAt: input.starts_at,
        endsAt: input.ends_at,
        location: input.location,
        notes: input.notes,
      }),
    );
    return { created_event_id: id };
  } catch (error) {
    if (error instanceof ValidationError) throw new InputError(error.message);
    throw error;
  }
}

function createStudyBlocks(db: Database, input: Input): unknown {
  if (
    !Array.isArray(input.blocks) ||
    input.blocks.length === 0 ||
    input.blocks.length > 30
  ) {
    throw new InputError("blocks 必须是 1 到 30 个学习块");
  }
  // Validate every block before writing any, so a bad one creates nothing.
  const blocks = input.blocks.map((raw, index) => {
    const block = asInput(raw);
    const start = instant(block, "starts_at");
    const end = instant(block, "ends_at");
    if (end <= start)
      throw new InputError(
        `第 ${index + 1} 个学习块的结束时间必须晚于开始时间`,
      );
    let assignmentId: number | null = null;
    if (block.assignment_id !== undefined && block.assignment_id !== null) {
      assignmentId = integer(block, "assignment_id");
      if (
        !db.query("SELECT 1 FROM assignments WHERE id = ?").get(assignmentId)
      ) {
        throw new InputError(`作业 ${assignmentId} 不存在`);
      }
    }
    return {
      title: text(block, "title"),
      startsAt: toBeijingIso(start),
      endsAt: toBeijingIso(end),
      minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      assignmentId,
    };
  });

  const insert = db.query(
    `INSERT INTO study_blocks (assignment_id, title, starts_at, ends_at, estimated_minutes)
     VALUES ($assignmentId, $title, $startsAt, $endsAt, $minutes)`,
  );
  const ids: number[] = [];
  db.transaction(() => {
    for (const block of blocks)
      ids.push(Number(insert.run(block).lastInsertRowid));
  })();
  return { created_study_block_ids: ids };
}

function setStudyBlockDone(db: Database, input: Input): unknown {
  const id = integer(input, "id");
  if (typeof input.done !== "boolean")
    throw new InputError("done 必须是布尔值");
  const result = db
    .query("UPDATE study_blocks SET done = ?, done_at = ? WHERE id = ?")
    .run(input.done ? 1 : 0, input.done ? new Date().toISOString() : null, id);
  if (result.changes === 0) throw new InputError(`学习块 ${id} 不存在`);
  return { id, done: input.done };
}

function deleteStudyBlock(db: Database, input: Input): unknown {
  const id = integer(input, "id");
  const result = db.query("DELETE FROM study_blocks WHERE id = ?").run(id);
  if (result.changes === 0) throw new InputError(`学习块 ${id} 不存在`);
  return { deleted_study_block_id: id };
}

const HANDLERS: Record<string, (db: Database, input: Input) => unknown> = {
  list_events: listEvents,
  list_assignments: listAssignments,
  find_free_slots: findFreeSlots,
  create_event: createEventTool,
  create_study_blocks: createStudyBlocks,
  set_study_block_done: setStudyBlockDone,
  delete_study_block: deleteStudyBlock,
};

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/**
 * Validates the model-supplied input and runs the tool. Problems with the
 * input come back as an error result the model can correct, never a throw.
 */
export function runTool(
  db: Database,
  name: string,
  rawInput: unknown,
): ToolOutcome {
  const tool = findTool(name);
  const handler = HANDLERS[name];
  if (!tool || !handler) {
    return {
      content: `没有名为 ${name} 的工具`,
      isError: true,
      changed: false,
    };
  }
  try {
    const result = handler(db, asInput(rawInput));
    return {
      content: JSON.stringify(result),
      isError: false,
      changed: tool.write,
    };
  } catch (error) {
    if (error instanceof InputError) {
      return { content: error.message, isError: true, changed: false };
    }
    throw error;
  }
}
