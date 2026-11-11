import { Database } from "bun:sqlite";
import path from "node:path";
import { ensureDataDir } from "./config";

/**
 * Ordered schema migrations. Append only: a released migration is never edited,
 * because `PRAGMA user_version` records how many have already run.
 */
const migrations: string[] = [
  `
  CREATE TABLE events (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL DEFAULT 'manual',  -- manual | zdbk | exam
    source_id   TEXT,                            -- id in the source system
    title       TEXT NOT NULL,
    location    TEXT,
    notes       TEXT,
    starts_at   TEXT NOT NULL,                   -- ISO 8601 with offset
    ends_at     TEXT NOT NULL,
    all_day     INTEGER NOT NULL DEFAULT 0,
    rrule       TEXT,                            -- RFC 5545 recurrence rule
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX events_source ON events(source, source_id)
    WHERE source_id IS NOT NULL;
  CREATE INDEX events_starts_at ON events(starts_at);

  CREATE TABLE assignments (
    id            INTEGER PRIMARY KEY,
    source        TEXT NOT NULL DEFAULT 'manual', -- manual | courses
    source_id     TEXT,
    course        TEXT,
    title         TEXT NOT NULL,
    due_at        TEXT,
    status        TEXT NOT NULL DEFAULT 'open',   -- open | done | dismissed
    url           TEXT,
    notified_48h  INTEGER NOT NULL DEFAULT 0,
    notified_24h  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX assignments_source ON assignments(source, source_id)
    WHERE source_id IS NOT NULL;
  CREATE INDEX assignments_due_at ON assignments(due_at);

  CREATE TABLE study_blocks (
    id                INTEGER PRIMARY KEY,
    assignment_id     INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    starts_at         TEXT NOT NULL,
    ends_at           TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    done              INTEGER NOT NULL DEFAULT 0,
    done_at           TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX study_blocks_starts_at ON study_blocks(starts_at);

  CREATE TABLE providers (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,                    -- openai-compatible | anthropic
    base_url    TEXT NOT NULL,
    model       TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE chats (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE messages (
    id          INTEGER PRIMARY KEY,
    chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,                    -- JSON content blocks
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX messages_chat ON messages(chat_id, id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                           -- JSON
  );

  CREATE TABLE sync_log (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    message     TEXT,
    item_count  INTEGER,
    started_at  TEXT NOT NULL,
    finished_at TEXT NOT NULL
  );
  `,
  `
  -- Which system calendar event each item was written to, and a hash of
  -- what was sent, so only changes are pushed.
  CREATE TABLE calendar_links (
    key      TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    hash     TEXT NOT NULL
  );
  `,
  `
  -- The wire format a chat's stored messages are in.
  ALTER TABLE chats ADD COLUMN kind TEXT NOT NULL DEFAULT 'anthropic';
  `,
  `
  -- A random identifier for the conversation, sent to providers that group
  -- requests by session.
  ALTER TABLE chats ADD COLUMN session_key TEXT;
  `,
  `
  -- What the course platform says about an assignment beyond its title.
  ALTER TABLE assignments ADD COLUMN kind TEXT;          -- homework, exam, ...
  ALTER TABLE assignments ADD COLUMN description TEXT;   -- plain text
  ALTER TABLE assignments ADD COLUMN attachments TEXT;   -- JSON array of file names
  ALTER TABLE assignments ADD COLUMN details_at TEXT;    -- when details were last fetched
  `,
];

export function migrate(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  for (; version < migrations.length; version++) {
    const sql = migrations[version]!;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
  return version;
}

export function openDatabase(file?: string): Database {
  const filename = file ?? path.join(ensureDataDir(), "studypal.sqlite");
  const db = new Database(filename, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

let shared: Database | undefined;

/** Process-wide database handle, opened on first use. */
export function getDb(): Database {
  return (shared ??= openDatabase());
}
