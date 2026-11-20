/**
 * Runs studyPal's real database code through the expo-sqlite wrapper, with
 * Bun's SQLite standing in for expo-sqlite's synchronous API.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createEvent, listEntries } from "@studypal/core/calendar/store";
import { migrate, prepareConnection } from "@studypal/core/db";
import { storeExams, storeTodos } from "@studypal/core/zju/sync";
import {
  bindParams,
  parameterNames,
  wrapDatabase,
  type SyncSqlite,
} from "./sqliteDb";

/** expo-sqlite's sync calls, implemented with `bun:sqlite` (non-strict). */
function fakeExpoSqlite(): { sqlite: SyncSqlite; raw: Database } {
  const raw = new Database(":memory:");
  const spread = (params: unknown) =>
    (Array.isArray(params) ? params : [params]) as never[];
  const sqlite = {
    getAllSync: (sql: string, params: unknown) =>
      raw.query(sql).all(...spread(params)),
    getFirstSync: (sql: string, params: unknown) =>
      raw.query(sql).get(...spread(params)),
    runSync: (sql: string, params: unknown) => {
      const result = raw.query(sql).run(...spread(params));
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    execSync: (sql: string) => {
      raw.exec(sql);
    },
  } as unknown as SyncSqlite;
  return { sqlite, raw };
}

function openWrapped() {
  const { sqlite, raw } = fakeExpoSqlite();
  const db = wrapDatabase(sqlite);
  prepareConnection(db);
  migrate(db);
  return { db, raw };
}

describe("parameter binding", () => {
  test("finds the $names a statement uses, ignoring string literals", () => {
    expect(
      parameterNames("INSERT INTO t VALUES ('$not', $a, $b, $a) -- x"),
    ).toEqual(["$a", "$b"]);
  });

  test("objects bind only used names, booleans become integers", () => {
    expect(
      bindParams([{ a: true, b: null, extra: 1 }], ["$a", "$b", "$c"]),
    ).toEqual({ $a: 1, $b: null, $c: null });
    expect(bindParams([1, "x", false, undefined], [])).toEqual([
      1,
      "x",
      0,
      null,
    ]);
  });
});

describe("core code on the wrapper", () => {
  test("migrations, inserts with ids, and reads", () => {
    const { db } = openWrapped();
    const id = createEvent(db, {
      title: "高等数学",
      location: "东 1A-101",
      notes: null,
      startsAt: "2026-11-19T08:00:00+08:00",
      endsAt: "2026-11-19T09:35:00+08:00",
      allDay: false,
      rrule: "FREQ=WEEKLY;COUNT=3",
    });
    expect(id).toBe(1);
    const entries = listEntries(
      db,
      new Date("2026-11-18T00:00:00Z"),
      new Date("2026-12-10T00:00:00Z"),
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      "高等数学",
      "高等数学",
      "高等数学",
    ]);
  });

  test("synced items with extra fields and upserts", () => {
    const { db, raw } = openWrapped();
    storeExams(db, [
      {
        id: "exam-1",
        course: "线性代数",
        kind: "final",
        location: "紫金港",
        seat: "12",
        startsAt: "2027-01-10T08:00:00+08:00",
        endsAt: "2027-01-10T10:00:00+08:00",
      } as never,
    ]);
    const todo = {
      id: "t1",
      title: "作业一",
      course: "数据结构",
      dueAt: "2026-11-20T23:59:00+08:00",
      kind: "homework",
      url: null,
    };
    storeTodos(db, [todo]);
    storeTodos(db, [{ ...todo, title: "作业一（修订）" }]);
    expect(raw.query("SELECT title, notes FROM events").all()).toEqual([
      { title: "期末考试：线性代数", notes: "座位号：12" },
    ]);
    expect(raw.query("SELECT title, status FROM assignments").all()).toEqual([
      { title: "作业一（修订）", status: "open" },
    ]);
  });

  test("nested transactions commit together and roll back inner failures", () => {
    const { db, raw } = openWrapped();
    const insert = db.query("INSERT INTO settings (key, value) VALUES (?, ?)");
    db.transaction(() => {
      insert.run("outer", "1");
      try {
        db.transaction(() => {
          insert.run("inner", "1");
          throw new Error("boom");
        })();
      } catch {
        // the inner transaction is rolled back on its own
      }
      db.transaction(() => insert.run("inner-ok", "1"))();
    })();
    expect(raw.query("SELECT key FROM settings ORDER BY key").all()).toEqual([
      { key: "inner-ok" },
      { key: "outer" },
    ]);

    expect(() =>
      db.transaction(() => {
        insert.run("lost", "1");
        throw new Error("boom");
      })(),
    ).toThrow("boom");
    expect(raw.query("SELECT count(*) AS n FROM settings").get()).toEqual({
      n: 2,
    });
  });
});
