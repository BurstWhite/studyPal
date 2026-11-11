import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db";
import { expand, formatRule, parseRule } from "./recurrence";
import {
  clearEvents,
  countEvents,
  createEvent,
  deleteEvent,
  listEntries,
  parseEventInput,
  updateEvent,
  ValidationError,
} from "./store";
import {
  buildItems,
  clearSystemCalendar,
  pushToSystemCalendar,
  systemCalendarStatus,
  type HelperRequest,
  type HelperResponse,
} from "./system";

const at = (iso: string) => new Date(iso);

describe("recurrence", () => {
  test("parses and formats the supported rule parts", () => {
    const rule = parseRule("FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T155959Z");
    expect(rule).toEqual({
      freq: "WEEKLY",
      interval: 2,
      until: at("2026-12-31T15:59:59Z"),
    });
    expect(formatRule(rule)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T155959Z",
    );
    expect(formatRule(parseRule("FREQ=DAILY;COUNT=3"))).toBe(
      "FREQ=DAILY;COUNT=3",
    );
  });

  test("a date-only UNTIL includes that whole day", () => {
    expect(parseRule("FREQ=DAILY;UNTIL=20261115").until).toEqual(
      at("2026-11-15T23:59:59Z"),
    );
  });

  test("rejects rules it cannot expand", () => {
    expect(() => parseRule("FREQ=MONTHLY")).toThrow();
    expect(() => parseRule("FREQ=WEEKLY;BYDAY=MO,WE")).toThrow();
    expect(() => parseRule("FREQ=WEEKLY;INTERVAL=0")).toThrow();
    expect(() => parseRule("INTERVAL=2")).toThrow();
  });

  test("a single event appears only when it overlaps the range", () => {
    const start = at("2026-11-10T09:00:00+08:00");
    const end = at("2026-11-10T10:00:00+08:00");
    const day = (d: number) => at(`2026-11-${d}T00:00:00+08:00`);
    expect(expand(start, end, null, day(10), day(11))).toHaveLength(1);
    expect(expand(start, end, null, day(11), day(12))).toHaveLength(0);
    // Touching the range boundary is not an overlap.
    expect(expand(start, end, null, end, day(11))).toHaveLength(0);
  });

  test("weekly events repeat on the same weekday inside the range", () => {
    const occurrences = expand(
      at("2026-09-14T08:00:00+08:00"),
      at("2026-09-14T09:35:00+08:00"),
      "FREQ=WEEKLY",
      at("2026-11-09T00:00:00+08:00"),
      at("2026-11-23T00:00:00+08:00"),
    );
    expect(occurrences.map((o) => o.start.toISOString())).toEqual([
      at("2026-11-09T08:00:00+08:00").toISOString(),
      at("2026-11-16T08:00:00+08:00").toISOString(),
    ]);
    expect(occurrences[0]!.end).toEqual(at("2026-11-09T09:35:00+08:00"));
  });

  test("biweekly events skip the off weeks", () => {
    const occurrences = expand(
      at("2026-11-02T08:00:00+08:00"),
      at("2026-11-02T09:00:00+08:00"),
      "FREQ=WEEKLY;INTERVAL=2",
      at("2026-11-01T00:00:00+08:00"),
      at("2026-12-01T00:00:00+08:00"),
    );
    expect(occurrences.map((o) => o.start.getUTCDate())).toEqual([2, 16, 30]);
  });

  test("COUNT and UNTIL end the series", () => {
    const start = at("2026-11-01T08:00:00+08:00");
    const end = at("2026-11-01T09:00:00+08:00");
    const from = at("2026-11-01T00:00:00+08:00");
    const to = at("2026-12-01T00:00:00+08:00");
    expect(expand(start, end, "FREQ=DAILY;COUNT=3", from, to)).toHaveLength(3);
    expect(
      expand(start, end, "FREQ=DAILY;UNTIL=20261105T000000Z", from, to),
    ).toHaveLength(5);
    // A range entirely after the series ended is empty.
    expect(
      expand(start, end, "FREQ=DAILY;COUNT=3", at("2026-11-10T00:00:00Z"), to),
    ).toHaveLength(0);
  });

  test("an occurrence that started before the range but runs into it is kept", () => {
    const occurrences = expand(
      at("2026-11-01T23:00:00+08:00"),
      at("2026-11-02T01:00:00+08:00"),
      "FREQ=DAILY",
      at("2026-11-05T00:00:00+08:00"),
      at("2026-11-06T00:00:00+08:00"),
    );
    expect(occurrences).toHaveLength(2);
  });
});

describe("event store", () => {
  const input = (overrides: Record<string, unknown> = {}) =>
    parseEventInput({
      title: "  组会 ",
      startsAt: "2026-11-10T14:00:00+08:00",
      endsAt: "2026-11-10T15:00:00+08:00",
      ...overrides,
    });

  test("validates input", () => {
    expect(input().title).toBe("组会");
    expect(input({ location: "  " }).location).toBeNull();
    expect(() => input({ title: " " })).toThrow(ValidationError);
    expect(() => input({ startsAt: "2026-11-10 14:00" })).toThrow(
      ValidationError,
    );
    expect(() => input({ startsAt: "2026-11-10T14:00:00" })).toThrow(
      ValidationError,
    );
    expect(() => input({ endsAt: "2026-11-10T14:00:00+08:00" })).toThrow(
      ValidationError,
    );
    expect(() => input({ rrule: "FREQ=YEARLY" })).toThrow(ValidationError);
    expect(() => parseEventInput(null)).toThrow(ValidationError);
  });

  test("creates, lists, updates and deletes manual events", () => {
    const db = openDatabase(":memory:");
    const id = createEvent(db, input({ rrule: "FREQ=WEEKLY" }));
    const from = at("2026-11-09T00:00:00+08:00");
    const to = at("2026-11-23T00:00:00+08:00");

    const entries = listEntries(db, from, to);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id,
      title: "组会",
      source: "manual",
      start: "2026-11-10T06:00:00.000Z",
      allDay: false,
      series: { startsAt: "2026-11-10T14:00:00+08:00", rrule: "FREQ=WEEKLY" },
    });

    expect(updateEvent(db, id, input({ title: "周会" }))).toBe("ok");
    const updated = listEntries(db, from, to);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.title).toBe("周会");

    expect(deleteEvent(db, id)).toBe("ok");
    expect(listEntries(db, from, to)).toHaveLength(0);
    expect(deleteEvent(db, id)).toBe("not-found");
  });

  test("synced events are read-only", () => {
    const db = openDatabase(":memory:");
    db.exec(
      `INSERT INTO events (id, source, source_id, title, starts_at, ends_at)
       VALUES (7, 'zdbk', 'x', '课', '2026-11-10T08:00:00+08:00', '2026-11-10T09:00:00+08:00')`,
    );
    expect(updateEvent(db, 7, input())).toBe("read-only");
    expect(deleteEvent(db, 7)).toBe("read-only");
  });
});

describe("clearing events", () => {
  function seed() {
    const db = openDatabase(":memory:");
    db.exec(`
      INSERT INTO events (source, source_id, title, starts_at, ends_at) VALUES
        ('manual', NULL, '组会', '2026-11-10T14:00:00+08:00', '2026-11-10T15:00:00+08:00'),
        ('manual', NULL, '跑步', '2026-11-11T07:00:00+08:00', '2026-11-11T08:00:00+08:00'),
        ('zdbk', 'a', '数据结构', '2026-11-09T08:00:00+08:00', '2026-11-09T09:35:00+08:00');
      INSERT INTO assignments (title) VALUES ('作业');
    `);
    return db;
  }
  const titles = (db: ReturnType<typeof seed>) =>
    db
      .query("SELECT title FROM events ORDER BY id")
      .all()
      .map((row) => (row as { title: string }).title);

  test("counts what each scope would remove", () => {
    expect(countEvents(seed())).toEqual({ manual: 2, synced: 1, all: 3 });
    expect(countEvents(openDatabase(":memory:"))).toEqual({
      manual: 0,
      synced: 0,
      all: 0,
    });
  });

  test("clears only the chosen scope and leaves assignments alone", () => {
    let db = seed();
    expect(clearEvents(db, "manual")).toBe(2);
    expect(titles(db)).toEqual(["数据结构"]);

    db = seed();
    expect(clearEvents(db, "synced")).toBe(1);
    expect(titles(db)).toEqual(["组会", "跑步"]);

    db = seed();
    expect(clearEvents(db, "all")).toBe(3);
    expect(titles(db)).toEqual([]);
    expect(db.query("SELECT count(*) AS n FROM assignments").get()).toEqual({
      n: 1,
    });
    expect(clearEvents(db, "all")).toBe(0);
  });
});

describe("system calendar", () => {
  /** A stand-in for the EventKit helper that keeps events in memory. */
  function fakeHelper() {
    const state = {
      calendarId: "CAL-1",
      events: new Map<string, { title: string; alarms: number[] }>(),
      requests: [] as HelperRequest[],
      nextId: 1,
    };
    const run = async (request: HelperRequest): Promise<HelperResponse> => {
      state.requests.push(request);
      const response: HelperResponse = {
        ok: true,
        calendarId: state.calendarId,
        calendarRecreated:
          request.calendarId !== null &&
          request.calendarId !== state.calendarId,
        eventIds: {},
      };
      if (response.calendarRecreated) return response;
      for (const id of request.deletes) state.events.delete(id);
      for (const item of request.upserts) {
        const id =
          item.eventId && state.events.has(item.eventId)
            ? item.eventId
            : `EV-${state.nextId++}`;
        state.events.set(id, { title: item.title, alarms: item.alarms });
        response.eventIds[item.key] = id;
      }
      return response;
    };
    return { run, state };
  }

  function seed() {
    const db = openDatabase(":memory:");
    createEvent(
      db,
      parseEventInput({
        title: "组会",
        startsAt: "2026-11-10T14:00:00+08:00",
        endsAt: "2026-11-10T15:00:00+08:00",
        rrule: "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T155959Z",
      }),
    );
    createEvent(
      db,
      parseEventInput({
        title: "运动会",
        allDay: true,
        startsAt: "2026-11-12T00:00:00+08:00",
        endsAt: "2026-11-14T00:00:00+08:00",
      }),
    );
    db.exec(`
      INSERT INTO assignments (id, course, title, due_at, status) VALUES
        (1, '数据结构', '实验三', '2026-11-20T23:59:00+08:00', 'open'),
        (2, '数据结构', '实验二', '2026-11-05T23:59:00+08:00', 'done'),
        (3, '数据结构', '没有截止时间', NULL, 'open');
      INSERT INTO study_blocks (id, assignment_id, title, starts_at, ends_at, estimated_minutes, done)
        VALUES (1, 1, '写实验三', '2026-11-18T19:00:00+08:00', '2026-11-18T21:00:00+08:00', 120, 0),
               (2, 1, '已完成的块', '2026-11-17T19:00:00+08:00', '2026-11-17T21:00:00+08:00', 120, 1);
    `);
    return db;
  }

  test("builds events, open deadlines with reminders, and unfinished study blocks", () => {
    const items = buildItems(seed());
    expect(items.map((item) => item.key)).toEqual([
      "event-1",
      "event-2",
      "assignment-1",
      "block-1",
    ]);
    expect(items[0]).toMatchObject({
      start: "2026-11-10T06:00:00Z",
      end: "2026-11-10T07:00:00Z",
      allDay: false,
      alarms: [],
      rule: { freq: "WEEKLY", interval: 2, until: "2026-12-31T15:59:59Z" },
    });
    // All-day events keep their local dates instead of shifting to UTC.
    expect(items[1]).toMatchObject({
      start: "2026-11-12",
      end: "2026-11-14",
      allDay: true,
      rule: null,
    });
    // The deadline entry ends at the due time; alarms fire 48 h and 24 h before it.
    expect(items[2]).toMatchObject({
      title: "截止：实验三",
      start: "2026-11-20T15:29:00Z",
      end: "2026-11-20T15:59:00Z",
      notes: "数据结构",
      alarms: [2850, 1410],
    });
  });

  test("the first push writes everything, the next writes nothing", async () => {
    const db = seed();
    const helper = fakeHelper();

    expect(await pushToSystemCalendar(db, helper.run)).toEqual({
      ok: true,
      total: 4,
      written: 4,
      removed: 0,
    });
    expect(helper.state.events.size).toBe(4);
    expect(helper.state.requests[0]!.calendarId).toBeNull();

    expect(await pushToSystemCalendar(db, helper.run)).toEqual({
      ok: true,
      total: 4,
      written: 0,
      removed: 0,
    });
    expect(helper.state.requests).toHaveLength(1);
  });

  test("later pushes send only changes and remove what is gone", async () => {
    const db = seed();
    const helper = fakeHelper();
    await pushToSystemCalendar(db, helper.run);

    db.exec(
      "UPDATE assignments SET due_at = '2026-11-21T23:59:00+08:00' WHERE id = 1",
    );
    db.exec("UPDATE study_blocks SET done = 1 WHERE id = 1");
    db.exec("DELETE FROM events WHERE id = 2");

    expect(await pushToSystemCalendar(db, helper.run)).toEqual({
      ok: true,
      total: 2,
      written: 1,
      removed: 2,
    });
    const request = helper.state.requests[1]!;
    expect(request.calendarId).toBe("CAL-1");
    // The changed deadline reuses its existing system event.
    expect(request.upserts.map((item) => [item.key, item.eventId])).toEqual([
      ["assignment-1", "EV-3"],
    ]);
    expect(request.deletes.sort()).toEqual(["EV-2", "EV-4"]);
    expect(helper.state.events.size).toBe(2);
  });

  test("a calendar deleted outside studyPal is rebuilt in full", async () => {
    const db = seed();
    const helper = fakeHelper();
    await pushToSystemCalendar(db, helper.run);

    helper.state.calendarId = "CAL-2";
    helper.state.events.clear();
    db.exec("UPDATE events SET title = '周会' WHERE id = 1");

    expect(await pushToSystemCalendar(db, helper.run)).toEqual({
      ok: true,
      total: 4,
      written: 4,
      removed: 0,
    });
    expect(helper.state.events.size).toBe(4);
    expect(
      db
        .query("SELECT value FROM settings WHERE key = 'system_calendar_id'")
        .get(),
    ).toEqual({
      value: '"CAL-2"',
    });
  });

  test("a denied permission is reported and nothing is recorded as written", async () => {
    const db = seed();
    const denied = async (): Promise<HelperResponse> => ({
      ok: false,
      code: "denied",
      error: "没有日历访问权限",
      calendarRecreated: false,
      eventIds: {},
    });
    const result = await pushToSystemCalendar(db, denied);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("隐私与安全性");
    expect(db.query("SELECT count(*) AS n FROM calendar_links").get()).toEqual({
      n: 0,
    });

    // Once access is granted the same push goes through.
    expect((await pushToSystemCalendar(db, fakeHelper().run)).written).toBe(4);
  });

  test("an item the helper did not confirm is retried next time", async () => {
    const db = seed();
    const helper = fakeHelper();
    const flaky = async (request: HelperRequest) => {
      const response = await helper.run(request);
      delete response.eventIds["block-1"];
      return response;
    };
    const first = await pushToSystemCalendar(db, flaky);
    expect(first).toEqual({ ok: false, message: "有 1 项没有写入系统日历" });
    const second = await pushToSystemCalendar(db, helper.run);
    expect(second).toEqual({ ok: true, total: 4, written: 1, removed: 0 });
  });
});

describe("system calendar repair and clearing", () => {
  /** A stand-in for the EventKit helper: one calendar holding events by id. */
  function fakeSystem() {
    const state = {
      calendarId: "CAL-1" as string | null,
      events: new Map<string, string>(),
      calls: [] as HelperRequest[],
      nextEvent: 1,
      nextCalendar: 2,
    };
    const run = async (request: HelperRequest): Promise<HelperResponse> => {
      state.calls.push(request);
      const response: HelperResponse = {
        ok: true,
        calendarRecreated: false,
        eventIds: {},
        missing: [],
        removed: false,
      };
      if (request.action === "clear") {
        if (
          request.calendarId !== null &&
          request.calendarId === state.calendarId
        ) {
          state.calendarId = null;
          state.events.clear();
          response.removed = true;
        }
        return response;
      }
      if (
        state.calendarId === null ||
        (request.calendarId !== null && request.calendarId !== state.calendarId)
      ) {
        // The calendar the caller knew is gone: make a new, empty one.
        const hadOne = request.calendarId !== null;
        state.calendarId = `CAL-${state.nextCalendar++}`;
        state.events.clear();
        response.calendarId = state.calendarId;
        response.calendarRecreated = hadOne;
        if (hadOne) return response;
      }
      response.calendarId = state.calendarId;
      response.missing = (request.verify ?? []).filter(
        (id) => !state.events.has(id),
      );
      for (const id of request.deletes) state.events.delete(id);
      for (const item of request.upserts) {
        const id =
          item.eventId && state.events.has(item.eventId)
            ? item.eventId
            : `EV-${state.nextEvent++}`;
        state.events.set(id, item.title);
        response.eventIds[item.key] = id;
      }
      return response;
    };
    return { run, state };
  }

  function seed() {
    const db = openDatabase(":memory:");
    for (const title of ["组会", "跑步", "答疑"]) {
      createEvent(
        db,
        parseEventInput({
          title,
          startsAt: "2026-11-10T14:00:00+08:00",
          endsAt: "2026-11-10T15:00:00+08:00",
        }),
      );
    }
    return db;
  }

  test("re-syncing the same classes does not rewrite them in the system calendar", async () => {
    const db = openDatabase(":memory:");
    const insert = (id: number) =>
      db
        .query(
          `INSERT INTO events (id, source, source_id, title, starts_at, ends_at)
           VALUES (?, 'zdbk', '2026-2027-1|数据结构|2026-11-09|6', '数据结构',
                   '2026-11-09T13:25:00+08:00', '2026-11-09T15:50:00+08:00')`,
        )
        .run(id);
    insert(1);
    const system = fakeSystem();
    expect(buildItems(db)[0]!.key).toBe(
      "zdbk:2026-2027-1|数据结构|2026-11-09|6",
    );
    await pushToSystemCalendar(db, system.run);

    // A sync deletes and re-inserts every class, which gives rows new ids.
    db.exec("DELETE FROM events");
    insert(42);
    expect(await pushToSystemCalendar(db, system.run)).toMatchObject({
      written: 0,
      removed: 0,
    });
    expect(system.state.calls).toHaveLength(1);
  });

  test("an ordinary push does not notice events deleted in the Calendar app", async () => {
    const db = seed();
    const system = fakeSystem();
    await pushToSystemCalendar(db, system.run);
    system.state.events.delete("EV-2");

    // Nothing changed in studyPal, so nothing is sent.
    expect(await pushToSystemCalendar(db, system.run)).toMatchObject({
      written: 0,
    });
    expect(system.state.events.size).toBe(2);
  });

  test("a verifying push writes back events deleted in the Calendar app", async () => {
    const db = seed();
    const system = fakeSystem();
    await pushToSystemCalendar(db, system.run);
    system.state.events.delete("EV-1");
    system.state.events.delete("EV-3");

    const result = await pushToSystemCalendar(db, system.run, { verify: true });
    expect(result).toEqual({ ok: true, total: 3, written: 2, removed: 0 });
    expect([...system.state.events.values()].sort()).toEqual(
      ["答疑", "组会", "跑步"].sort(),
    );

    // With everything in place, verifying finds nothing to do.
    expect(
      await pushToSystemCalendar(db, system.run, { verify: true }),
    ).toMatchObject({ written: 0 });
  });

  test("a verifying push rebuilds a calendar that was deleted", async () => {
    const db = seed();
    const system = fakeSystem();
    await pushToSystemCalendar(db, system.run);
    system.state.calendarId = null;
    system.state.events.clear();

    const result = await pushToSystemCalendar(db, system.run, { verify: true });
    expect(result).toEqual({ ok: true, total: 3, written: 3, removed: 0 });
    expect(system.state.events.size).toBe(3);
    expect(systemCalendarStatus(db).hasCalendar).toBe(true);
  });

  test("a denied permission while verifying is reported", async () => {
    const db = seed();
    await pushToSystemCalendar(db, fakeSystem().run);
    const denied = async (): Promise<HelperResponse> => ({
      ok: false,
      code: "denied",
      calendarRecreated: false,
      eventIds: {},
    });
    const result = await pushToSystemCalendar(db, denied, { verify: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("隐私与安全性");
  });

  test("clearing deletes the calendar, forgets what was written, and switches mirroring off", async () => {
    const db = seed();
    const system = fakeSystem();
    db.query(
      "INSERT INTO settings (key, value) VALUES ('system_calendar_enabled', 'true')",
    ).run();
    await pushToSystemCalendar(db, system.run);
    expect(systemCalendarStatus(db)).toMatchObject({
      enabled: true,
      hasCalendar: true,
    });

    expect(await clearSystemCalendar(db, system.run)).toMatchObject({
      ok: true,
    });
    expect(system.state.calendarId).toBeNull();
    expect(system.state.events.size).toBe(0);
    expect(system.state.calls.at(-1)).toMatchObject({
      action: "clear",
      calendarId: "CAL-1",
    });
    expect(db.query("SELECT count(*) AS n FROM calendar_links").get()).toEqual({
      n: 0,
    });
    expect(systemCalendarStatus(db)).toEqual({
      enabled: false,
      hasCalendar: false,
      last: null,
    });
    // studyPal's own events are untouched.
    expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 3,
    });

    // Switching it back on writes everything into a fresh calendar.
    expect(await pushToSystemCalendar(db, system.run)).toMatchObject({
      written: 3,
    });
    expect(system.state.calendarId).toBe("CAL-2");
  });

  test("clearing with no calendar on record does not call the helper", async () => {
    const db = seed();
    const system = fakeSystem();
    expect(await clearSystemCalendar(db, system.run)).toMatchObject({
      ok: true,
    });
    expect(system.state.calls).toHaveLength(0);
  });

  test("a failed clear keeps the record so it can be tried again", async () => {
    const db = seed();
    await pushToSystemCalendar(db, fakeSystem().run);
    const failing = async (): Promise<HelperResponse> => ({
      ok: false,
      code: "failed",
      error: "磁盘错误",
      calendarRecreated: false,
      eventIds: {},
    });
    expect(await clearSystemCalendar(db, failing)).toEqual({
      ok: false,
      message: "磁盘错误",
    });
    expect(db.query("SELECT count(*) AS n FROM calendar_links").get()).toEqual({
      n: 3,
    });
    expect(systemCalendarStatus(db).hasCalendar).toBe(true);
  });
});
