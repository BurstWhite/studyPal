import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db";
import { freeSlots, mergeIntervals, toBeijingIso } from "../scheduler/slots";
import { AnthropicConversation } from "./anthropic";
import { OpenAiConversation } from "./openai";
import {
  appendMessages,
  ChatUnavailable,
  createChat,
  createProvider,
  deleteProvider,
  displayMessages,
  getChat,
  getProvider,
  listProviders,
  loadMessages,
  openConversation,
  parseProviderInput,
  ProviderInputError,
  setDefaultProvider,
  updateProvider,
  type KeyStore,
} from "./store";
import { runTool, TOOLS } from "./tools";
import { runTurn, timeContext, TurnError, type TurnEvent } from "./turn";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-10T09:00:00+08:00");

describe("free slots", () => {
  const span = (start: string, end: string) => ({
    start: at(start),
    end: at(end),
  });
  const show = (slots: { start: Date; end: Date }[]) =>
    slots.map(
      (slot) =>
        `${toBeijingIso(slot.start).slice(5, 16)}→${toBeijingIso(slot.end).slice(11, 16)}`,
    );

  test("merges overlapping and touching intervals", () => {
    const merged = mergeIntervals([
      span("2026-11-10T10:00:00+08:00", "2026-11-10T11:00:00+08:00"),
      span("2026-11-10T08:00:00+08:00", "2026-11-10T09:00:00+08:00"),
      span("2026-11-10T09:00:00+08:00", "2026-11-10T09:30:00+08:00"),
      span("2026-11-10T10:30:00+08:00", "2026-11-10T12:00:00+08:00"),
    ]);
    expect(show(merged)).toEqual(["11-10T08:00→09:30", "11-10T10:00→12:00"]);
  });

  test("returns the gaps inside each day's window", () => {
    const slots = freeSlots(
      [
        span("2026-11-10T08:00:00+08:00", "2026-11-10T09:35:00+08:00"),
        span("2026-11-10T13:25:00+08:00", "2026-11-10T15:00:00+08:00"),
        span("2026-11-11T07:00:00+08:00", "2026-11-11T23:00:00+08:00"),
      ],
      at("2026-11-10T00:00:00+08:00"),
      at("2026-11-12T00:00:00+08:00"),
    );
    // The second day is fully booked.
    expect(show(slots)).toEqual(["11-10T09:35→13:25", "11-10T15:00→22:00"]);
  });

  test("starts from `from`, drops short gaps, and honours the minimum length", () => {
    const busy = [
      span("2026-11-10T10:20:00+08:00", "2026-11-10T21:30:00+08:00"),
    ];
    const from = at("2026-11-10T10:00:00+08:00");
    const to = at("2026-11-11T00:00:00+08:00");
    expect(show(freeSlots(busy, from, to))).toEqual(["11-10T21:30→22:00"]);
    expect(show(freeSlots(busy, from, to, { minMinutes: 20 }))).toEqual([
      "11-10T10:00→10:20",
      "11-10T21:30→22:00",
    ]);
    expect(freeSlots(busy, from, to, { minMinutes: 60 })).toEqual([]);
  });

  test("an empty calendar gives the whole window of every day", () => {
    const slots = freeSlots(
      [],
      at("2026-11-10T00:00:00+08:00"),
      at("2026-11-12T00:00:00+08:00"),
    );
    expect(show(slots)).toEqual(["11-10T08:00→22:00", "11-11T08:00→22:00"]);
  });
});

function seededDb() {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO events (source, source_id, title, location, starts_at, ends_at) VALUES
      ('zdbk', 'c1', '数据结构', '东1-101', '2026-11-10T08:00:00+08:00', '2026-11-10T09:35:00+08:00'),
      ('manual', NULL, '组会', NULL, '2026-11-10T14:00:00+08:00', '2026-11-10T15:00:00+08:00');
    INSERT INTO assignments (id, course, title, due_at, status) VALUES
      (1, '数据结构', '实验三', '2026-11-12T23:59:00+08:00', 'open'),
      (2, '数据结构', '实验二', '2026-11-05T23:59:00+08:00', 'done');
  `);
  return db;
}

describe("tools", () => {
  const call = (
    db: ReturnType<typeof seededDb>,
    name: string,
    input: unknown,
  ) => {
    const outcome = runTool(db, name, input);
    return {
      ...outcome,
      data: outcome.isError ? outcome.content : JSON.parse(outcome.content),
    };
  };
  const day = {
    from: "2026-11-10T00:00:00+08:00",
    to: "2026-11-11T00:00:00+08:00",
  };

  test("every tool has an object schema that forbids extra fields", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(TOOLS.filter((tool) => tool.write).map((tool) => tool.name)).toEqual(
      [
        "create_event",
        "create_study_blocks",
        "set_reminders",
        "set_study_block_done",
        "delete_study_block",
      ],
    );
  });

  test("reads events, assignments and free slots in Beijing time", () => {
    const db = seededDb();
    expect(call(db, "list_events", day).data.items).toEqual([
      {
        kind: "class",
        id: 1,
        title: "数据结构",
        start: "2026-11-10T08:00:00+08:00",
        end: "2026-11-10T09:35:00+08:00",
        all_day: false,
        location: "东1-101",
      },
      {
        kind: "event",
        id: 2,
        title: "组会",
        start: "2026-11-10T14:00:00+08:00",
        end: "2026-11-10T15:00:00+08:00",
        all_day: false,
        location: null,
      },
    ]);
    expect(call(db, "list_assignments", {}).data.assignments).toEqual([
      {
        id: 1,
        course: "数据结构",
        title: "实验三",
        due: "2026-11-12T23:59:00+08:00",
        status: "open",
        // The built-in reminders every deadline has.
        reminders_minutes_before: [2880, 1440],
      },
    ]);
    expect(
      call(db, "list_assignments", { include_closed: true }).data.assignments,
    ).toHaveLength(2);
    expect(
      call(db, "find_free_slots", { ...day, min_minutes: 60 }).data.slots,
    ).toEqual([
      {
        start: "2026-11-10T09:35:00+08:00",
        end: "2026-11-10T14:00:00+08:00",
        minutes: 265,
      },
      {
        start: "2026-11-10T15:00:00+08:00",
        end: "2026-11-10T22:00:00+08:00",
        minutes: 420,
      },
    ]);
  });

  test("creates study blocks, which then count as busy time", () => {
    const db = seededDb();
    const created = call(db, "create_study_blocks", {
      blocks: [
        {
          title: "写实验三",
          starts_at: "2026-11-10T19:00:00+08:00",
          ends_at: "2026-11-10T21:00:00+08:00",
          assignment_id: 1,
        },
        {
          title: "复习",
          starts_at: "2026-11-10T10:00:00Z",
          ends_at: "2026-11-10T10:30:00Z",
        },
      ],
    });
    expect(created).toMatchObject({
      isError: false,
      changed: true,
      data: { created_study_block_ids: [1, 2] },
    });
    expect(
      db
        .query(
          "SELECT title, starts_at, estimated_minutes, assignment_id FROM study_blocks",
        )
        .all(),
    ).toEqual([
      {
        title: "写实验三",
        starts_at: "2026-11-10T19:00:00+08:00",
        estimated_minutes: 120,
        assignment_id: 1,
      },
      {
        title: "复习",
        starts_at: "2026-11-10T18:00:00+08:00",
        estimated_minutes: 30,
        assignment_id: null,
      },
    ]);
    const slots = call(db, "find_free_slots", { ...day, min_minutes: 60 }).data
      .slots;
    expect(slots.at(-1)).toMatchObject({ start: "2026-11-10T21:00:00+08:00" });
    expect(
      call(db, "list_events", day).data.items.filter(
        (i: { kind: string }) => i.kind === "study_block",
      ),
    ).toHaveLength(2);
  });

  test("one invalid block means none are created", () => {
    const db = seededDb();
    const result = call(db, "create_study_blocks", {
      blocks: [
        {
          title: "好的",
          starts_at: "2026-11-10T19:00:00+08:00",
          ends_at: "2026-11-10T20:00:00+08:00",
        },
        {
          title: "反了",
          starts_at: "2026-11-10T21:00:00+08:00",
          ends_at: "2026-11-10T20:00:00+08:00",
        },
      ],
    });
    expect(result).toMatchObject({ isError: true, changed: false });
    expect(result.data).toContain("第 2 个");
    expect(db.query("SELECT count(*) AS n FROM study_blocks").get()).toEqual({
      n: 0,
    });
    expect(
      call(db, "create_study_blocks", {
        blocks: [
          {
            title: "x",
            starts_at: "2026-11-10T19:00:00+08:00",
            ends_at: "2026-11-10T20:00:00+08:00",
            assignment_id: 99,
          },
        ],
      }).data,
    ).toBe("作业 99 不存在");
  });

  test("marks study blocks done, deletes them, and adds events", () => {
    const db = seededDb();
    call(db, "create_study_blocks", {
      blocks: [
        {
          title: "写实验三",
          starts_at: "2026-11-10T19:00:00+08:00",
          ends_at: "2026-11-10T21:00:00+08:00",
        },
      ],
    });
    expect(
      call(db, "set_study_block_done", { id: 1, done: true }).data,
    ).toEqual({ id: 1, done: true });
    expect(
      db
        .query("SELECT done, done_at IS NOT NULL AS stamped FROM study_blocks")
        .get(),
    ).toEqual({ done: 1, stamped: 1 });
    expect(
      call(db, "set_study_block_done", { id: 9, done: true }).isError,
    ).toBe(true);
    expect(call(db, "delete_study_block", { id: 1 }).changed).toBe(true);
    expect(call(db, "delete_study_block", { id: 1 }).isError).toBe(true);

    const event = call(db, "create_event", {
      title: "答疑",
      starts_at: "2026-11-11T10:00:00+08:00",
      ends_at: "2026-11-11T11:00:00+08:00",
      location: "西2",
    });
    expect(event).toMatchObject({ isError: false, changed: true });
    expect(
      db
        .query("SELECT source, title, location FROM events WHERE id = ?")
        .get(event.data.created_event_id),
    ).toEqual({
      source: "manual",
      title: "答疑",
      location: "西2",
    });
  });

  test("events and study blocks can be created with reminders", () => {
    const db = seededDb();
    db.exec(
      "INSERT INTO settings (key, value) VALUES ('system_calendar_enabled', 'true')",
    );
    const event = call(db, "create_event", {
      title: "答疑",
      starts_at: "2026-11-10T16:00:00+08:00",
      ends_at: "2026-11-10T17:00:00+08:00",
      reminders_minutes_before: [30, 1440, 30],
    });
    // With the system calendar on there is nothing to warn about.
    expect(event.data).toEqual({ created_event_id: 3 });
    call(db, "create_study_blocks", {
      blocks: [
        {
          title: "带提醒",
          starts_at: "2026-11-10T19:00:00+08:00",
          ends_at: "2026-11-10T20:00:00+08:00",
          reminders_minutes_before: [10],
        },
        {
          title: "不带",
          starts_at: "2026-11-10T20:00:00+08:00",
          ends_at: "2026-11-10T21:00:00+08:00",
        },
      ],
    });
    const items = call(db, "list_events", day).data.items as any[];
    // Longest lead first, duplicates dropped.
    expect(
      items.find((i) => i.title === "答疑").reminders_minutes_before,
    ).toEqual([1440, 30]);
    expect(
      items.find((i) => i.title === "带提醒").reminders_minutes_before,
    ).toEqual([10]);
    expect(items.find((i) => i.title === "不带")).not.toHaveProperty(
      "reminders_minutes_before",
    );
  });

  test("set_reminders adds to the built-in reminders and can be cleared", () => {
    const db = seededDb();
    db.exec(
      "INSERT INTO settings (key, value) VALUES ('system_calendar_enabled', 'true')",
    );
    const reminders = () =>
      call(db, "list_assignments", {}).data.assignments[0]
        .reminders_minutes_before;

    expect(
      call(db, "set_reminders", {
        target: "assignment",
        id: 1,
        minutes_before: [120],
      }),
    ).toMatchObject({
      isError: false,
      changed: true,
      data: { target: "assignment", id: 1, reminders_minutes_before: [120] },
    });
    // The 48 h and 24 h reminders stay; the new one is added.
    expect(reminders()).toEqual([2880, 1440, 120]);
    // Setting again replaces only what the user had set.
    call(db, "set_reminders", {
      target: "assignment",
      id: 1,
      minutes_before: [4320, 60],
    });
    expect(reminders()).toEqual([4320, 2880, 1440, 60]);
    call(db, "set_reminders", {
      target: "assignment",
      id: 1,
      minutes_before: [],
    });
    expect(reminders()).toEqual([2880, 1440]);

    // A synced class, by the id list_events reports.
    call(db, "set_reminders", { target: "event", id: 1, minutes_before: [15] });
    expect(call(db, "list_events", day).data.items[0]).toMatchObject({
      kind: "class",
      reminders_minutes_before: [15],
    });
  });

  test("the model is told when reminders cannot sound yet", () => {
    const db = seededDb();
    const result = call(db, "set_reminders", {
      target: "event",
      id: 2,
      minutes_before: [30],
    });
    expect(result.isError).toBe(false);
    expect(result.data.note).toContain("系统日历");
    // Clearing reminders needs no such warning.
    expect(
      call(db, "set_reminders", { target: "event", id: 2, minutes_before: [] })
        .data,
    ).not.toHaveProperty("note");
  });

  test("set_reminders rejects bad targets, ids and times", () => {
    const db = seededDb();
    db.exec(
      "INSERT INTO assignments (id, title, status) VALUES (9, '没有截止时间', 'open')",
    );
    const fail = (input: object) => call(db, "set_reminders", input);
    expect(fail({ target: "chat", id: 1, minutes_before: [5] }).data).toContain(
      "target",
    );
    expect(fail({ target: "event", id: 99, minutes_before: [5] }).data).toBe(
      "日程 99 不存在",
    );
    expect(
      fail({ target: "study_block", id: 1, minutes_before: [5] }).data,
    ).toBe("学习块 1 不存在");
    expect(
      fail({ target: "assignment", id: 9, minutes_before: [5] }).data,
    ).toContain("没有截止时间");
    expect(fail({ target: "event", id: 1 }).data).toContain("minutes_before");
    expect(fail({ target: "event", id: 1, minutes_before: [-5] }).isError).toBe(
      true,
    );
    expect(
      fail({ target: "event", id: 1, minutes_before: [1.5] }).isError,
    ).toBe(true);
    expect(
      fail({ target: "event", id: 1, minutes_before: [50000] }).data,
    ).toContain("4 周");
    expect(
      fail({ target: "event", id: 1, minutes_before: [1, 2, 3, 4, 5, 6] }).data,
    ).toContain("最多");
    expect(fail({ target: "event", id: 1, minutes_before: "30" }).isError).toBe(
      true,
    );
    // A rejected create writes nothing.
    expect(
      call(db, "create_event", {
        title: "x",
        starts_at: day.from,
        ends_at: day.to,
        reminders_minutes_before: [-1],
      }).isError,
    ).toBe(true);
    expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 2,
    });
  });

  test("bad input comes back as an error for the model, not a throw", () => {
    const db = seededDb();
    expect(
      call(db, "list_events", { from: "2026-11-10", to: "2026-11-11" }).data,
    ).toContain("ISO 8601");
    expect(call(db, "list_events", { from: day.to, to: day.from }).data).toBe(
      "to 必须晚于 from",
    );
    expect(
      call(db, "list_events", {
        from: "2026-01-01T00:00:00Z",
        to: "2026-12-01T00:00:00Z",
      }).data,
    ).toContain("62 天");
    expect(
      call(db, "find_free_slots", { ...day, min_minutes: 1 }).isError,
    ).toBe(true);
    expect(
      call(db, "create_event", {
        title: "",
        starts_at: day.from,
        ends_at: day.to,
      }).isError,
    ).toBe(true);
    expect(call(db, "list_events", "nope").isError).toBe(true);
    expect(call(db, "drop_database", {}).data).toContain("没有名为");
  });
});

/** Builds an Anthropic streaming response body from content blocks. */
function anthropicSse(
  blocks: (
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; json: string }
  )[],
  stopReason: string,
): Response {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ],
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        },
      ]);
      for (const piece of block.text.match(/.{1,4}/gs) ?? []) {
        events.push([
          "content_block_delta",
          {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: piece },
          },
        ]);
      }
    } else {
      events.push([
        "content_block_start",
        {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
          },
        },
      ]);
      events.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: block.json },
        },
      ]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 20 },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  const body = events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Builds an OpenAI-style streaming response body. */
function openAiSse(deltas: unknown[], finishReason: string): Response {
  const chunks = [
    ...deltas.map((delta) => ({ choices: [{ delta, finish_reason: null }] })),
    { choices: [{ delta: {}, finish_reason: finishReason }] },
  ];
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** A fetch that answers with the queued responses and records each request. */
function scripted(responses: Response[]) {
  const requests: { url: string; headers: Headers; body: any }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers as HeadersInit),
      body: JSON.parse(String(init?.body)),
    });
    const next = responses.shift();
    if (!next) throw new Error("no scripted response left");
    return next;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const BLOCKS_JSON = JSON.stringify({
  blocks: [
    {
      title: "写实验三",
      starts_at: "2026-11-10T19:00:00+08:00",
      ends_at: "2026-11-10T21:00:00+08:00",
      assignment_id: 1,
    },
  ],
});

async function collect(
  run: (emit: (event: TurnEvent) => void) => Promise<unknown>,
) {
  const events: TurnEvent[] = [];
  const result = await run((event) => events.push(event));
  const text = events
    .filter((e) => e.type === "text")
    .map((e) => (e as { delta: string }).delta)
    .join("");
  return { events, text, result };
}

describe("Anthropic conversation", () => {
  const settings = (fetchImpl: typeof fetch, extra: object = {}) => ({
    apiKey: "sk-test",
    baseUrl: "",
    model: "claude-opus-5-5",
    fetch: fetchImpl,
    ...extra,
  });
  const never = new AbortController().signal;

  test("runs a read tool, then an approved write, then answers", async () => {
    const db = seededDb();
    const api = scripted([
      anthropicSse(
        [
          { type: "text", text: "我先看一下作业。" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "list_assignments",
            json: "{}",
          },
        ],
        "tool_use",
      ),
      anthropicSse(
        [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "create_study_blocks",
            json: BLOCKS_JSON,
          },
        ],
        "tool_use",
      ),
      anthropicSse(
        [{ type: "text", text: "已经安排在今晚 19:00。" }],
        "end_turn",
      ),
    ]);
    const conversation = new AnthropicConversation(settings(api.fetchImpl));
    conversation.addUser("帮我安排实验三", NOW);

    const approvals: string[] = [];
    const { events, text, result } = await collect((emit) =>
      runTurn(
        db,
        conversation,
        TOOLS,
        emit,
        async (call) => (approvals.push(call.name), true),
        never,
      ),
    );

    expect(result).toEqual({ changed: true });
    expect(text).toBe("我先看一下作业。已经安排在今晚 19:00。");
    // Only the write asked for approval.
    expect(approvals).toEqual(["create_study_blocks"]);
    expect(
      events
        .filter((e) => e.type === "tool_call")
        .map((e: any) => [e.name, e.needsApproval]),
    ).toEqual([
      ["list_assignments", false],
      ["create_study_blocks", true],
    ]);
    expect(db.query("SELECT title FROM study_blocks").all()).toEqual([
      { title: "写实验三" },
    ]);

    // What was sent: stable cached system prompt, tools, and the refusal fallback.
    const first = api.requests[0]!;
    expect(first.url).toContain("api.anthropic.com/v1/messages");
    expect(first.headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(first.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      stream: true,
      fallbacks: "default",
    });
    expect(first.body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(first.body.tools).toHaveLength(TOOLS.length);
    expect(first.body.tools[0].eager_input_streaming).toBe(true);
    expect(first.body.messages[0].content[0].text).toBe(timeContext(NOW));
    expect(first.body).not.toHaveProperty("thinking");
    expect(first.body).not.toHaveProperty("temperature");

    // The second request replays the assistant turn and its tool result unchanged.
    const second = api.requests[1]!.body.messages;
    expect(second.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(second[1].content.map((b: any) => b.type)).toEqual([
      "text",
      "tool_use",
    ]);
    expect(second[2].content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      is_error: false,
    });

    expect(conversation.display()).toEqual([
      { type: "user", text: "帮我安排实验三" },
      { type: "assistant", text: "我先看一下作业。" },
      {
        type: "tool",
        id: "toolu_1",
        name: "list_assignments",
        input: {},
        result: { ok: true, content: expect.stringContaining("实验三") },
      },
      {
        type: "tool",
        id: "toolu_2",
        name: "create_study_blocks",
        input: JSON.parse(BLOCKS_JSON),
        result: { ok: true, content: '{"created_study_block_ids":[1]}' },
      },
      { type: "assistant", text: "已经安排在今晚 19:00。" },
    ]);
  });

  test("a declined write is not run and the model is told", async () => {
    const db = seededDb();
    const api = scripted([
      anthropicSse(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "create_study_blocks",
            json: BLOCKS_JSON,
          },
        ],
        "tool_use",
      ),
      anthropicSse(
        [{ type: "text", text: "好的，那你想改到什么时候？" }],
        "end_turn",
      ),
    ]);
    const conversation = new AnthropicConversation(settings(api.fetchImpl));
    conversation.addUser("安排一下", NOW);

    const { events, result } = await collect((emit) =>
      runTurn(db, conversation, TOOLS, emit, async () => false, never),
    );
    expect(result).toEqual({ changed: false });
    expect(db.query("SELECT count(*) AS n FROM study_blocks").get()).toEqual({
      n: 0,
    });
    expect(events.find((e) => e.type === "tool_result")).toEqual({
      type: "tool_result",
      id: "toolu_1",
      ok: false,
      declined: true,
    });
    expect(api.requests[1]!.body.messages[2].content[0]).toMatchObject({
      is_error: true,
      content: "用户没有同意这次操作。",
    });
  });

  test("a custom endpoint gets no beta features", async () => {
    const api = scripted([
      anthropicSse([{ type: "text", text: "你好" }], "end_turn"),
    ]);
    const conversation = new AnthropicConversation(
      settings(api.fetchImpl, { baseUrl: "https://proxy.example.com" }),
    );
    conversation.addUser("hi", NOW);
    await conversation.step(TOOLS, () => {}, never);
    const request = api.requests[0]!;
    expect(request.url).toStartWith("https://proxy.example.com/v1/messages");
    expect(request.headers.get("anthropic-beta")).toBeNull();
    expect(request.body).not.toHaveProperty("fallbacks");
    expect(request.body.tools[0]).not.toHaveProperty("eager_input_streaming");
  });

  test("a refusal, a truncated tool call and an API error each end the turn with a message", async () => {
    const run = async (response: Response) => {
      const conversation = new AnthropicConversation(
        settings(scripted([response]).fetchImpl),
      );
      conversation.addUser("hi", NOW);
      const before = conversation.messages().length;
      const error = await conversation
        .step(TOOLS, () => {}, never)
        .catch((e) => e);
      // Nothing from the failed response is kept.
      expect(conversation.messages()).toHaveLength(before);
      return error;
    };
    const refusal = await run(anthropicSse([], "refusal"));
    expect(refusal).toBeInstanceOf(TurnError);
    expect(refusal.message).toContain("拒绝");

    const truncated = await run(
      anthropicSse(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "list_assignments",
            json: "{}",
          },
        ],
        "max_tokens",
      ),
    );
    expect(truncated.message).toContain("长度上限");

    const unauthorized = await run(
      Response.json(
        {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        },
        { status: 401 },
      ),
    );
    expect(unauthorized).toBeInstanceOf(TurnError);
    expect(unauthorized.message).toBe("API key 无效，请在设置里检查。");
  });
});

describe("OpenAI-compatible conversation", () => {
  const settings = (fetchImpl: typeof fetch) => ({
    apiKey: "sk-test",
    baseUrl: "https://llm.example.com/v1/",
    model: "some-model",
    fetch: fetchImpl,
  });
  const never = new AbortController().signal;

  test("assembles fragmented tool calls and completes the loop", async () => {
    const db = seededDb();
    const half = Math.floor(BLOCKS_JSON.length / 2);
    const api = scripted([
      openAiSse(
        [
          { content: "我来安排。" },
          {
            tool_calls: [
              {
                index: 0,
                id: "call_a",
                function: {
                  name: "create_study_blocks",
                  arguments: BLOCKS_JSON.slice(0, half),
                },
              },
            ],
          },
          {
            tool_calls: [
              { index: 0, function: { arguments: BLOCKS_JSON.slice(half) } },
            ],
          },
          {
            tool_calls: [
              {
                index: 1,
                id: "call_b",
                function: { name: "list_assignments", arguments: "{}" },
              },
            ],
          },
        ],
        "tool_calls",
      ),
      openAiSse([{ content: "安排好了。" }], "stop"),
    ]);
    const conversation = new OpenAiConversation(settings(api.fetchImpl));
    conversation.addUser("帮我安排实验三", NOW);

    const { text, result } = await collect((emit) =>
      runTurn(db, conversation, TOOLS, emit, async () => true, never),
    );
    expect(result).toEqual({ changed: true });
    expect(text).toBe("我来安排。安排好了。");
    expect(db.query("SELECT title FROM study_blocks").all()).toEqual([
      { title: "写实验三" },
    ]);

    const first = api.requests[0]!;
    expect(first.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(first.headers.get("authorization")).toBe("Bearer sk-test");
    expect(first.body).toMatchObject({ model: "some-model", stream: true });
    expect(first.body.messages[0].role).toBe("system");
    expect(first.body.tools[0]).toMatchObject({
      type: "function",
      function: { name: "list_events" },
    });

    // Both results go back, each tied to its call.
    const sent = api.requests[1]!.body.messages;
    expect(sent.map((m: any) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(sent[3]).toMatchObject({
      tool_call_id: "call_a",
      content: '{"created_study_block_ids":[1]}',
    });
    expect(sent[4].tool_call_id).toBe("call_b");

    expect(conversation.display().map((item) => item.type)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "assistant",
    ]);
    expect(conversation.display()[0]).toEqual({
      type: "user",
      text: "帮我安排实验三",
    });
  });

  test("arguments that are not JSON go back to the model as an error", async () => {
    const db = seededDb();
    const api = scripted([
      openAiSse(
        [
          {
            tool_calls: [
              {
                index: 0,
                id: "call_a",
                function: { name: "list_events", arguments: '{"from": ' },
              },
            ],
          },
        ],
        "tool_calls",
      ),
      openAiSse([{ content: "抱歉，我重试。" }], "stop"),
    ]);
    const conversation = new OpenAiConversation(settings(api.fetchImpl));
    conversation.addUser("今天有什么课", NOW);
    await runTurn(
      db,
      conversation,
      TOOLS,
      () => {},
      async () => true,
      never,
    );
    const toolMessage = api.requests[1]!.body.messages[3];
    expect(toolMessage.content).toStartWith("ERROR: ");
    expect(toolMessage.content).toContain("INVALID_JSON");
    expect(conversation.display()[1]).toMatchObject({
      type: "tool",
      result: { ok: false },
    });
  });

  test("HTTP errors become readable messages", async () => {
    const attempt = async (response: Response) => {
      const conversation = new OpenAiConversation(
        settings(scripted([response]).fetchImpl),
      );
      conversation.addUser("hi", NOW);
      return conversation
        .step(TOOLS, () => {}, never)
        .then(
          () => new Error("expected the step to fail"),
          (e) => e as Error,
        );
    };
    expect((await attempt(new Response("{}", { status: 401 }))).message).toBe(
      "API key 无效，请在设置里检查。",
    );
    expect(
      (
        await attempt(
          Response.json(
            { error: { message: "model overloaded" } },
            { status: 503 },
          ),
        )
      ).message,
    ).toBe("模型服务返回 HTTP 503：model overloaded");
    expect((await attempt(openAiSse([], "stop"))).message).toBe(
      "模型没有返回任何内容。",
    );
  });
});

describe("providers and chats", () => {
  function memoryKeys(): KeyStore & { values: Map<number, string> } {
    const values = new Map<number, string>();
    return {
      values,
      get: async (id) => values.get(id) ?? null,
      set: async (id, value) => void values.set(id, value),
      delete: async (id) => void values.delete(id),
    };
  }
  const anthropic = {
    kind: "anthropic",
    model: "claude-opus-5-5",
    apiKey: "sk-a",
  };
  const compatible = {
    kind: "openai-compatible",
    name: "本地",
    baseUrl: "http://localhost:11434/v1",
    model: "m",
    apiKey: "k",
  };

  test("validates provider input", () => {
    expect(parseProviderInput(anthropic, true)).toEqual({
      name: "claude-opus-5-5",
      kind: "anthropic",
      baseUrl: "",
      model: "claude-opus-5-5",
      apiKey: "sk-a",
    });
    expect(() =>
      parseProviderInput({ ...anthropic, kind: "other" }, true),
    ).toThrow(ProviderInputError);
    expect(() =>
      parseProviderInput({ ...anthropic, model: " " }, true),
    ).toThrow("模型名称");
    expect(() =>
      parseProviderInput({ ...anthropic, apiKey: "" }, true),
    ).toThrow("API key");
    expect(() =>
      parseProviderInput({ ...compatible, baseUrl: "" }, true),
    ).toThrow("Base URL");
    expect(() =>
      parseProviderInput({ ...compatible, baseUrl: "ftp://x" }, true),
    ).toThrow("http");
    // Updating may leave the key blank to keep the stored one.
    expect(parseProviderInput({ ...anthropic, apiKey: "" }, false).apiKey).toBe(
      "",
    );
  });

  test("keys go to the key store, and one provider is always the default", async () => {
    const db = openDatabase(":memory:");
    const keys = memoryKeys();
    const a = await createProvider(
      db,
      parseProviderInput(anthropic, true),
      keys,
    );
    const b = await createProvider(
      db,
      parseProviderInput(compatible, true),
      keys,
    );
    expect(listProviders(db).map((p) => [p.name, p.isDefault])).toEqual([
      ["claude-opus-5-5", true],
      ["本地", false],
    ]);
    expect(keys.values.get(a)).toBe("sk-a");
    expect(
      JSON.stringify(db.query("SELECT * FROM providers").all()),
    ).not.toContain("sk-a");

    await updateProvider(
      db,
      a,
      parseProviderInput(
        { ...anthropic, model: "claude-sonnet-5-5", apiKey: "" },
        false,
      ),
      keys,
    );
    expect(getProvider(db, a)!.model).toBe("claude-sonnet-5-5");
    expect(keys.values.get(a)).toBe("sk-a");

    expect(setDefaultProvider(db, b)).toBe(true);
    expect(setDefaultProvider(db, 99)).toBe(false);
    expect(await deleteProvider(db, b, keys)).toBe(true);
    expect(listProviders(db).map((p) => p.isDefault)).toEqual([true]);
    expect(keys.values.has(b)).toBe(false);
  });

  test("a chat stores finished turns and replays them through its provider", async () => {
    const db = seededDb();
    const keys = memoryKeys();
    const providerId = await createProvider(
      db,
      parseProviderInput(anthropic, true),
      keys,
    );
    const chatId = createChat(db, getProvider(db, providerId)!);

    const api = scripted([
      anthropicSse([{ type: "text", text: "你周二有数据结构。" }], "end_turn"),
      anthropicSse([{ type: "text", text: "不客气。" }], "end_turn"),
    ]);
    for (const message of [
      "我周二有什么课？这个标题会被截断因为它实在是太长太长太长太长了",
      "谢谢",
    ]) {
      const conversation = await openConversation(
        db,
        getChat(db, chatId)!,
        keys,
        api.fetchImpl,
      );
      const before = conversation.messages().length;
      conversation.addUser(message, NOW);
      await runTurn(
        db,
        conversation,
        TOOLS,
        () => {},
        async () => true,
        new AbortController().signal,
      );
      appendMessages(
        db,
        chatId,
        conversation.messages().slice(before),
        message.slice(0, 30),
      );
    }

    const chat = getChat(db, chatId)!;
    expect(chat.title).toBe(
      "我周二有什么课？这个标题会被截断因为它实在是太长太长太长太长了".slice(
        0,
        30,
      ),
    );
    expect(chat.kind).toBe("anthropic");
    expect(
      displayMessages(chat.kind, loadMessages(db, chatId)).map((i) => i.type),
    ).toEqual(["user", "assistant", "user", "assistant"]);
    // The second request carried the first exchange.
    expect(api.requests[1]!.body.messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    // The key the user saved is the credential sent, not anything from the environment.
    expect(api.requests[1]!.headers.get("authorization")).toBe("Bearer sk-a");
  });

  test("a chat whose provider is gone or has no key cannot continue", async () => {
    const db = openDatabase(":memory:");
    const keys = memoryKeys();
    const providerId = await createProvider(
      db,
      parseProviderInput(anthropic, true),
      keys,
    );
    const chatId = createChat(db, getProvider(db, providerId)!);

    keys.values.delete(providerId);
    expect(openConversation(db, getChat(db, chatId)!, keys)).rejects.toThrow(
      "API key",
    );

    await deleteProvider(db, providerId, keys);
    expect(getChat(db, chatId)!.providerId).toBeNull();
    expect(
      openConversation(db, getChat(db, chatId)!, keys),
    ).rejects.toBeInstanceOf(ChatUnavailable);
  });
});

describe("DeepSeek and OpenCode providers", () => {
  const keys: KeyStore = {
    get: async () => "sk-test",
    set: async () => {},
    delete: async () => {},
  };
  const never = new AbortController().signal;

  async function chatWith(db: ReturnType<typeof openDatabase>, input: object) {
    const providerId = await createProvider(
      db,
      parseProviderInput(input, true),
      keys,
    );
    return createChat(db, getProvider(db, providerId)!);
  }
  async function turn(
    db: ReturnType<typeof openDatabase>,
    chatId: number,
    fetchImpl: typeof fetch,
    text: string,
  ) {
    const conversation = await openConversation(
      db,
      getChat(db, chatId)!,
      keys,
      fetchImpl,
    );
    const before = conversation.messages().length;
    conversation.addUser(text, NOW);
    const events: TurnEvent[] = [];
    await runTurn(
      db,
      conversation,
      TOOLS,
      (event) => events.push(event),
      async () => true,
      never,
    );
    appendMessages(db, chatId, conversation.messages().slice(before), text);
    return events;
  }

  test("both kinds need only a model and a key", () => {
    expect(
      parseProviderInput(
        { kind: "deepseek", model: "deepseek-flash", apiKey: "k" },
        true,
      ),
    ).toMatchObject({
      kind: "deepseek",
      baseUrl: "",
      name: "deepseek-flash",
    });
    expect(
      parseProviderInput(
        { kind: "opencode", model: "kimi-k3", apiKey: "k" },
        true,
      ).kind,
    ).toBe("opencode");
    expect(() =>
      parseProviderInput({ kind: "opencode", model: "", apiKey: "k" }, true),
    ).toThrow("模型名称");
    expect(() =>
      parseProviderInput(
        { kind: "deepseek", model: "m", apiKey: "k", baseUrl: "nope" },
        true,
      ),
    ).toThrow("http");
  });

  test("DeepSeek: reasoning is sent back on every later request, in the tool loop and in later turns", async () => {
    const db = seededDb();
    const chatId = await chatWith(db, {
      kind: "deepseek",
      model: "deepseek-flash",
      apiKey: "sk-test",
    });
    const api = scripted([
      openAiSse(
        [
          { reasoning_content: "先看看" },
          { reasoning_content: "有哪些作业。" },
          {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "list_assignments", arguments: "{}" },
              },
            ],
          },
        ],
        "tool_calls",
      ),
      openAiSse(
        [
          { reasoning_content: "只有一项。" },
          { content: "你有一项作业：实验三。" },
        ],
        "stop",
      ),
      openAiSse([{ content: "不客气。" }], "stop"),
    ]);

    const events = await turn(db, chatId, api.fetchImpl, "我有哪些作业？");
    // The user sees a thinking indicator, never the reasoning text itself.
    expect(events.filter((e) => e.type === "thinking")).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("先看看");

    expect(api.requests[0]!.url).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(api.requests[0]!.headers.get("authorization")).toBe(
      "Bearer sk-test",
    );
    expect(api.requests[0]!.headers.get("x-opencode-session")).toBeNull();

    // Second request of the same turn carries the first response's reasoning.
    const inLoop = api.requests[1]!.body.messages;
    expect(inLoop[2]).toMatchObject({
      role: "assistant",
      content: null,
      reasoning_content: "先看看有哪些作业。",
    });
    expect(inLoop[2].tool_calls).toHaveLength(1);

    // A later turn, loaded back from the database, still carries all of it.
    await turn(db, chatId, api.fetchImpl, "谢谢");
    const later = api.requests[2]!.body.messages.filter(
      (m: any) => m.role === "assistant",
    );
    expect(later.map((m: any) => m.reasoning_content)).toEqual([
      "先看看有哪些作业。",
      "只有一项。",
    ]);

    expect(
      displayMessages("deepseek", loadMessages(db, chatId)).map(
        (item) => item.type,
      ),
    ).toEqual(["user", "tool", "assistant", "user", "assistant"]);
  });

  test("a provider that returns no reasoning gets none sent back", async () => {
    const db = seededDb();
    const chatId = await chatWith(db, {
      kind: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
      model: "m",
      apiKey: "k",
    });
    const api = scripted([
      openAiSse([{ content: "你好" }], "stop"),
      openAiSse([{ content: "在" }], "stop"),
    ]);
    await turn(db, chatId, api.fetchImpl, "hi");
    await turn(db, chatId, api.fetchImpl, "在吗");
    expect(api.requests[1]!.body.messages[2]).toEqual({
      role: "assistant",
      content: "你好",
    });
  });

  test("OpenCode: every request of a chat carries the same x-opencode-session, distinct per chat", async () => {
    const db = seededDb();
    const input = { kind: "opencode", model: "kimi-k3", apiKey: "sk-test" };
    const first = await chatWith(db, input);
    const second = createChat(
      db,
      getProvider(db, getChat(db, first)!.providerId!)!,
    );
    const api = scripted([
      openAiSse(
        [
          {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "list_assignments", arguments: "{}" },
              },
            ],
          },
        ],
        "tool_calls",
      ),
      openAiSse([{ content: "一项。" }], "stop"),
      openAiSse([{ content: "好。" }], "stop"),
      openAiSse([{ content: "你好。" }], "stop"),
    ]);
    await turn(db, first, api.fetchImpl, "我有哪些作业？");
    await turn(db, first, api.fetchImpl, "好的");
    await turn(db, second, api.fetchImpl, "你好");

    expect(api.requests[0]!.url).toBe(
      "https://opencode.ai/inference/openai/v1/chat/completions",
    );
    const sessions = api.requests.map((request) =>
      request.headers.get("x-opencode-session"),
    );
    expect(sessions[0]).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(new Set(sessions.slice(0, 3)).size).toBe(1);
    expect(sessions[3]).not.toBe(sessions[0]);
    expect(api.requests[0]!.headers.get("authorization")).toBe(
      "Bearer sk-test",
    );
  });

  test("OpenCode Go uses its own address, with the session and client identity it requires", async () => {
    const db = seededDb();
    const chatId = await chatWith(db, {
      kind: "opencode-go",
      model: "kimi-k3",
      apiKey: "sk-test",
    });
    const api = scripted([openAiSse([{ content: "好" }], "stop")]);
    await turn(db, chatId, api.fetchImpl, "hi");

    const request = api.requests[0]!;
    // Not the pay-as-you-go address, which answers a Go key with HTTP 402.
    expect(request.url).toBe(
      "https://opencode.ai/inference/go/openai/v1/chat/completions",
    );
    expect(request.headers.get("x-opencode-session")).toMatch(
      /^ses_[0-9a-f]{32}$/,
    );
    expect(request.headers.get("user-agent")).toBe("studyPal/0.1.0");
    expect(request.headers.get("authorization")).toBe("Bearer sk-test");
    expect(
      displayMessages("opencode-go", loadMessages(db, chatId)),
    ).toHaveLength(2);
  });

  test("a chat created before session keys existed gets one on first use and keeps it", async () => {
    const db = seededDb();
    const chatId = await chatWith(db, {
      kind: "opencode",
      model: "kimi-k3",
      apiKey: "sk-test",
    });
    db.query("UPDATE chats SET session_key = NULL WHERE id = ?").run(chatId);
    const api = scripted([
      openAiSse([{ content: "一" }], "stop"),
      openAiSse([{ content: "二" }], "stop"),
    ]);
    await turn(db, chatId, api.fetchImpl, "a");
    await turn(db, chatId, api.fetchImpl, "b");
    const [one, two] = api.requests.map((request) =>
      request.headers.get("x-opencode-session"),
    );
    expect(one).toBeTruthy();
    expect(two).toBe(one);
  });

  test("a custom Base URL overrides the built-in address", async () => {
    const db = seededDb();
    const chatId = await chatWith(db, {
      kind: "deepseek",
      model: "deepseek-flash",
      apiKey: "k",
      baseUrl: "https://proxy.example.com/ds/",
    });
    const api = scripted([openAiSse([{ content: "好" }], "stop")]);
    await turn(db, chatId, api.fetchImpl, "hi");
    expect(api.requests[0]!.url).toBe(
      "https://proxy.example.com/ds/chat/completions",
    );
  });
});
