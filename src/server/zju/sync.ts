/**
 * Pulls the timetable and pending coursework from ZJU into the database.
 * The two halves are independent: one failing does not discard the other.
 */
import type { Database } from "bun:sqlite";
import { casLogin, isSignedIn } from "./cas";
import { coursesLogin, fetchActivity, fetchTodos, type Todo } from "./courses";
import { HttpSession, type FetchLike } from "./http";
import {
  academicYearOf,
  expandSlot,
  fetchSchoolCalendar,
  joinAdjacentSlots,
  type SchoolCalendar,
} from "./schoolCalendar";
import {
  CaptchaRequired,
  fetchExams,
  fetchTimetable,
  mergeSlots,
  SEASONS,
  zdbkLogin,
  type Exam,
  type TimetableSlot,
} from "./zdbk";

export interface Credentials {
  username: string;
  password: string;
}

export interface PartResult {
  ok: boolean;
  /** Number of items stored, when ok. */
  count?: number;
  message?: string;
}

export interface SyncResult {
  timetable: PartResult;
  exams: PartResult;
  assignments: PartResult;
  /** Set when the timetable needs a captcha answer to continue. */
  captcha?: { imageDataUrl: string };
}

export interface SyncOptions {
  fetchImpl?: FetchLike;
  now?: Date;
  /** The user's answer to a captcha returned by the previous attempt. */
  captcha?: string;
}

interface DatedClass {
  sourceId: string;
  title: string;
  location: string | null;
  notes: string | null;
  startsAt: string;
  endsAt: string;
}

/** Dated classes of one term, ready to store. */
export function buildClasses(
  termId: string,
  slots: TimetableSlot[],
  calendar: SchoolCalendar,
): DatedClass[] {
  const classes = new Map<string, DatedClass>();
  for (const slot of joinAdjacentSlots(slots, calendar)) {
    for (const occurrence of expandSlot(slot, calendar)) {
      const sourceId = `${termId}|${slot.name}|${occurrence.date}|${slot.firstPeriod}`;
      classes.set(sourceId, {
        sourceId,
        title: slot.name,
        location: slot.location,
        notes: slot.teacher ? `教师：${slot.teacher}` : null,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
      });
    }
  }
  return [...classes.values()];
}

/**
 * Deletes every synced event of one source and returns the reminders the
 * user had set on them, by source id, so they survive being re-inserted.
 */
function takeReminders(db: Database, source: string): Map<string, string> {
  const rows = db
    .query(
      "SELECT source_id, reminders FROM events WHERE source = ? AND reminders IS NOT NULL",
    )
    .all(source) as { source_id: string; reminders: string }[];
  db.query("DELETE FROM events WHERE source = ?").run(source);
  return new Map(rows.map((row) => [row.source_id, row.reminders]));
}

function restoreReminders(db: Database, id: number, reminders?: string): void {
  if (reminders === undefined) return;
  db.query("UPDATE events SET reminders = ? WHERE id = ?").run(reminders, id);
}

/** Replaces every synced class with `classes`. */
export function storeClasses(db: Database, classes: DatedClass[]): void {
  const insert = db.query(
    `INSERT INTO events (source, source_id, title, location, notes, starts_at, ends_at)
     VALUES ('zdbk', $sourceId, $title, $location, $notes, $startsAt, $endsAt)`,
  );
  db.transaction(() => {
    const kept = takeReminders(db, "zdbk");
    for (const item of classes) {
      const id = Number(insert.run({ ...item }).lastInsertRowid);
      restoreReminders(db, id, kept.get(item.sourceId));
    }
  })();
}

/** Replaces every synced exam with `exams`. */
export function storeExams(db: Database, exams: Exam[]): void {
  const insert = db.query(
    `INSERT INTO events (source, source_id, title, location, notes, starts_at, ends_at)
     VALUES ('exam', $id, $title, $location, $notes, $startsAt, $endsAt)`,
  );
  db.transaction(() => {
    const kept = takeReminders(db, "exam");
    for (const exam of exams) {
      const result = insert.run({
        id: exam.id,
        title: `${exam.kind === "midterm" ? "期中考试" : "期末考试"}：${exam.course}`,
        location: exam.location,
        notes: exam.seat ? `座位号：${exam.seat}` : null,
        startsAt: exam.startsAt,
        endsAt: exam.endsAt,
      });
      restoreReminders(db, Number(result.lastInsertRowid), kept.get(exam.id));
    }
  })();
}

/**
 * Stores the current to-do list. Items already known keep their status; a
 * changed deadline re-arms its reminders. Open items that left the list were
 * submitted or closed, so they are marked done.
 */
export function storeTodos(db: Database, todos: Todo[]): void {
  const upsert = db.query(
    `INSERT INTO assignments (source, source_id, course, title, due_at, kind, url)
     VALUES ('courses', $id, $course, $title, $dueAt, $kind, $url)
     ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
       course = excluded.course,
       title = excluded.title,
       kind = excluded.kind,
       url = excluded.url,
       notified_48h = CASE WHEN due_at IS excluded.due_at THEN notified_48h ELSE 0 END,
       notified_24h = CASE WHEN due_at IS excluded.due_at THEN notified_24h ELSE 0 END,
       due_at = excluded.due_at,
       updated_at = datetime('now')`,
  );
  db.transaction(() => {
    for (const todo of todos) upsert.run({ ...todo });
    const present = new Set(todos.map((todo) => todo.id));
    const open = db
      .query(
        "SELECT id, source_id FROM assignments WHERE source = 'courses' AND status = 'open'",
      )
      .all() as { id: number; source_id: string }[];
    const close = db.query(
      "UPDATE assignments SET status = 'done', updated_at = datetime('now') WHERE id = ?",
    );
    for (const row of open) {
      if (!present.has(row.source_id)) close.run(row.id);
    }
  })();
}

/** How many assignments get their details fetched in one sync. */
const DETAILS_PER_SYNC = 20;

/**
 * Fetches the description and attachments of open assignments that do not
 * have them yet. Returns how many could not be fetched; those are retried on
 * the next sync.
 */
export async function fillAssignmentDetails(
  db: Database,
  session: HttpSession,
): Promise<number> {
  const pending = db
    .query(
      `SELECT id, source_id FROM assignments
       WHERE source = 'courses' AND status = 'open' AND details_at IS NULL
       ORDER BY due_at IS NULL, due_at LIMIT ${DETAILS_PER_SYNC}`,
    )
    .all() as { id: number; source_id: string }[];
  const save = db.query(
    "UPDATE assignments SET description = ?, attachments = ?, details_at = ? WHERE id = ?",
  );
  let failed = 0;
  for (const row of pending) {
    try {
      const details = await fetchActivity(session, row.source_id);
      save.run(
        details.description || null,
        JSON.stringify(details.attachments),
        new Date().toISOString(),
        row.id,
      );
    } catch {
      failed++;
    }
  }
  return failed;
}

function log(
  db: Database,
  source: string,
  startedAt: Date,
  result: PartResult,
): void {
  db.query(
    `INSERT INTO sync_log (source, ok, message, item_count, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    source,
    result.ok ? 1 : 0,
    result.message ?? null,
    result.count ?? null,
    startedAt.toISOString(),
    new Date().toISOString(),
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError"
      ? "请求超时，请检查网络"
      : error.message;
  }
  return String(error);
}

/**
 * A captcha answer only works on the session that was shown the image, so
 * that session is kept here between the two attempts.
 */
let awaitingCaptcha: HttpSession | undefined;

async function syncTimetable(
  db: Database,
  session: HttpSession,
  options: SyncOptions,
): Promise<{ result: PartResult; captcha?: CaptchaRequired }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const academicYear = academicYearOf(options.now ?? new Date());

  const classes: DatedClass[] = [];
  for (const term of ["1", "2"] as const) {
    const termId = `${academicYear}-${term}`;
    const calendar = await fetchSchoolCalendar(termId, fetchImpl);
    // A term whose calendar is not published yet cannot be dated; skip it.
    if (!calendar) continue;

    const slots: TimetableSlot[] = [];
    for (const season of SEASONS.filter((name) => name.startsWith(term))) {
      try {
        slots.push(
          ...(await fetchTimetable(
            session,
            academicYear,
            season,
            options.captcha,
          )),
        );
      } catch (error) {
        if (error instanceof CaptchaRequired) {
          return {
            result: { ok: false, message: error.message },
            captcha: error,
          };
        }
        throw error;
      }
    }
    classes.push(...buildClasses(termId, mergeSlots(slots), calendar));
  }

  storeClasses(db, classes);
  return { result: { ok: true, count: classes.length } };
}

export async function runSync(
  db: Database,
  credentials: Credentials,
  options: SyncOptions = {},
): Promise<SyncResult> {
  // Reuse the session that was shown the captcha; otherwise start clean.
  const resuming =
    options.captcha !== undefined && awaitingCaptcha !== undefined;
  const session = resuming
    ? awaitingCaptcha!
    : new HttpSession(options.fetchImpl);
  awaitingCaptcha = undefined;

  if (!isSignedIn(session)) {
    try {
      await casLogin(session, credentials.username, credentials.password);
    } catch (error) {
      const failed = { ok: false, message: describe(error) };
      log(db, "zdbk", new Date(), failed);
      log(db, "exam", new Date(), failed);
      log(db, "courses", new Date(), failed);
      return { timetable: failed, exams: failed, assignments: failed };
    }
  }

  const result: SyncResult = {
    timetable: { ok: false },
    exams: { ok: false },
    assignments: { ok: false },
  };

  let started = new Date();
  // Both the timetable and the exams need the academic-system session.
  let zdbkReady = resuming;
  try {
    if (!resuming) await zdbkLogin(session);
    zdbkReady = true;
    const timetable = await syncTimetable(db, session, options);
    result.timetable = timetable.result;
    if (timetable.captcha) {
      awaitingCaptcha = session;
      const { image, contentType } = timetable.captcha;
      result.captcha = {
        imageDataUrl: `data:${contentType};base64,${Buffer.from(image).toString("base64")}`,
      };
    }
  } catch (error) {
    result.timetable = { ok: false, message: describe(error) };
  }
  log(db, "zdbk", started, result.timetable);

  started = new Date();
  if (!zdbkReady) {
    result.exams = { ok: false, message: result.timetable.message };
  } else {
    try {
      const exams = await fetchExams(session);
      storeExams(db, exams);
      result.exams = { ok: true, count: exams.length };
    } catch (error) {
      result.exams = { ok: false, message: describe(error) };
    }
  }
  log(db, "exam", started, result.exams);

  started = new Date();
  try {
    await coursesLogin(session);
    const todos = await fetchTodos(session);
    storeTodos(db, todos);
    // Details are a bonus: failing to get them does not fail the sync.
    const missing = await fillAssignmentDetails(db, session);
    result.assignments = {
      ok: true,
      count: todos.length,
      ...(missing > 0 ? { message: `有 ${missing} 项的作业详情没有取到` } : {}),
    };
  } catch (error) {
    result.assignments = { ok: false, message: describe(error) };
  }
  log(db, "courses", started, result.assignments);

  return result;
}
