import type { Database } from "bun:sqlite";
import { guarded } from "../auth";
import { scheduleSystemCalendarPush } from "../calendar/system";
import { getDb } from "../db";
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  savedUsername,
} from "../zju/account";
import { casLogin, LoginError } from "../zju/cas";
import { HttpSession } from "../zju/http";
import { runSync, type SyncResult } from "../zju/sync";

export interface SyncLogEntry {
  ok: boolean;
  message: string | null;
  itemCount: number | null;
  finishedAt: string;
}

export interface AccountStatus {
  username: string | null;
  lastSync: {
    timetable: SyncLogEntry | null;
    exams: SyncLogEntry | null;
    assignments: SyncLogEntry | null;
  };
}

function lastLog(db: Database, source: string): SyncLogEntry | null {
  const row = db
    .query(
      `SELECT ok, message, item_count, finished_at FROM sync_log
       WHERE source = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(source) as {
    ok: number;
    message: string | null;
    item_count: number | null;
    finished_at: string;
  } | null;
  return (
    row && {
      ok: row.ok === 1,
      message: row.message,
      itemCount: row.item_count,
      finishedAt: row.finished_at,
    }
  );
}

export function accountStatus(db: Database): AccountStatus {
  return {
    username: savedUsername(db) ?? null,
    lastSync: {
      timetable: lastLog(db, "zdbk"),
      exams: lastLog(db, "exam"),
      assignments: lastLog(db, "courses"),
    },
  };
}

let running: Promise<SyncResult> | undefined;

/**
 * Runs a sync with the saved account, or returns undefined when none is
 * saved. Concurrent callers share the sync that is already in flight.
 */
export async function syncNow(
  captcha?: string,
): Promise<SyncResult | undefined> {
  if (running) return running;
  const db = getDb();
  const credentials = await loadCredentials(db);
  if (!credentials) return undefined;
  running = runSync(db, credentials, { captcha }).finally(() => {
    running = undefined;
    scheduleSystemCalendarPush(db);
  });
  return running;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const zjuRoutes = {
  "/api/zju/account": {
    GET: guarded(() => Response.json(accountStatus(getDb()))),

    /** Verifies the account by signing in before anything is saved. */
    PUT: guarded(async (req: Request) => {
      const body = await readJson(req);
      const username =
        typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || !password) {
        return Response.json({ error: "请填写学号和密码" }, { status: 400 });
      }
      try {
        await casLogin(new HttpSession(), username, password);
      } catch (error) {
        if (error instanceof LoginError) {
          return Response.json({ error: error.message }, { status: 400 });
        }
        const message =
          error instanceof Error && error.name === "TimeoutError"
            ? "连接统一身份认证超时，请检查网络"
            : `无法连接统一身份认证：${error instanceof Error ? error.message : String(error)}`;
        return Response.json({ error: message }, { status: 502 });
      }
      await saveCredentials(getDb(), { username, password });
      return Response.json(accountStatus(getDb()));
    }),

    DELETE: guarded(async () => {
      await clearCredentials(getDb());
      return Response.json(accountStatus(getDb()));
    }),
  },

  "/api/zju/sync": {
    POST: guarded(async (req: Request) => {
      const body = await readJson(req);
      const captcha =
        typeof body.captcha === "string" ? body.captcha.trim() : undefined;
      const result = await syncNow(captcha);
      if (!result) {
        return Response.json({ error: "还没有保存浙大账号" }, { status: 400 });
      }
      return Response.json(result);
    }),
  },
};
