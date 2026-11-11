import { describe, expect, test } from "bun:test";
import { handleAuth, isAuthorized, isLocalHost } from "./auth";
import { migrate, openDatabase } from "./db";
import { readOverview } from "./routes/system";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    headers: { host: new URL(url).host, ...headers },
  });
}

describe("database", () => {
  test("migrations create every table and are idempotent", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "assignments",
      "calendar_links",
      "chats",
      "events",
      "messages",
      "providers",
      "settings",
      "study_blocks",
      "sync_log",
    ]);

    const version = migrate(db);
    expect(migrate(db)).toBe(version);
  });

  test("a synced item cannot be stored twice, manual items can repeat", () => {
    const db = openDatabase(":memory:");
    const insert = db.query(
      "INSERT INTO assignments (source, source_id, title) VALUES (?, ?, ?)",
    );
    insert.run("courses", "42", "作业一");
    expect(() => insert.run("courses", "42", "作业一")).toThrow();
    insert.run("manual", null, "自己加的");
    insert.run("manual", null, "自己加的");
  });

  test("deleting an assignment removes its study blocks", () => {
    const db = openDatabase(":memory:");
    db.exec("INSERT INTO assignments (id, title) VALUES (1, 'a')");
    db.exec(
      `INSERT INTO study_blocks (assignment_id, title, starts_at, ends_at, estimated_minutes)
       VALUES (1, 'b', '2026-11-10T09:00:00+08:00', '2026-11-10T10:00:00+08:00', 60)`,
    );
    db.exec("DELETE FROM assignments WHERE id = 1");
    expect(readOverview(db).studyBlocks).toBe(0);
  });

  test("overview counts only open assignments and done blocks", () => {
    const db = openDatabase(":memory:");
    db.exec(`
      INSERT INTO assignments (title, status) VALUES ('a', 'open'), ('b', 'done');
      INSERT INTO study_blocks (title, starts_at, ends_at, estimated_minutes, done)
        VALUES ('x', '2026-11-10T09:00:00+08:00', '2026-11-10T10:00:00+08:00', 60, 1),
               ('y', '2026-11-11T09:00:00+08:00', '2026-11-11T10:00:00+08:00', 60, 0);
    `);
    expect(readOverview(db)).toEqual({
      events: 0,
      openAssignments: 1,
      studyBlocks: 2,
      studyBlocksDone: 1,
      providers: 0,
    });
  });
});

describe("auth", () => {
  const token = "a".repeat(64);

  test("only loopback hosts are local", () => {
    expect(isLocalHost(request("http://127.0.0.1:47821/"))).toBe(true);
    expect(isLocalHost(request("http://localhost:47821/"))).toBe(true);
    expect(isLocalHost(request("http://evil.example:47821/"))).toBe(false);
  });

  test("without a token, loopback requests are allowed", () => {
    expect(isAuthorized(request("http://127.0.0.1/api/x"), "")).toBe(true);
    expect(isAuthorized(request("http://evil.example/api/x"), "")).toBe(false);
  });

  test("with a token, the session cookie is required", () => {
    const url = "http://127.0.0.1:47821/api/x";
    expect(isAuthorized(request(url), token)).toBe(false);
    expect(
      isAuthorized(request(url, { cookie: "studypal_session=wrong" }), token),
    ).toBe(false);
    expect(
      isAuthorized(
        request(url, { cookie: `other=1; studypal_session=${token}` }),
        token,
      ),
    ).toBe(true);
  });

  test("the auth route trades the token for a cookie", () => {
    const ok = handleAuth(
      request(`http://127.0.0.1:47821/auth?token=${token}`),
      token,
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toMatch(/^\/\?launch=[0-9a-z]+$/);
    expect(ok.headers.get("set-cookie")).toContain(`studypal_session=${token}`);

    const bad = handleAuth(
      request("http://127.0.0.1:47821/auth?token=nope"),
      token,
    );
    expect(bad.status).toBe(403);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });
});
