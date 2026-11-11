import type { Database } from "bun:sqlite";
import { guarded } from "../auth";
import { scheduleSystemCalendarPush } from "../calendar/system";
import { getDb } from "../db";

export type AssignmentStatus = "open" | "done" | "dismissed";

export interface Assignment {
  id: number;
  source: string;
  course: string | null;
  title: string;
  /** ISO 8601 instant, or null. */
  dueAt: string | null;
  status: AssignmentStatus;
  /** The assignment's page on the course platform. */
  url: string | null;
  /** The platform's activity type, e.g. `homework`. */
  kind: string | null;
  /** The assignment text, when the platform provided one. */
  description: string | null;
  /** Names of attached files. */
  attachments: string[];
}

const STATUSES: AssignmentStatus[] = ["open", "done", "dismissed"];

/** Open items first (soonest deadline first, undated last), then the rest. */
export function listAssignments(db: Database): Assignment[] {
  const rows = db
    .query(
      `SELECT id, source, course, title, due_at, status, url, kind, description, attachments
       FROM assignments
       ORDER BY status != 'open', due_at IS NULL, due_at, id`,
    )
    .all() as {
    id: number;
    source: string;
    course: string | null;
    title: string;
    due_at: string | null;
    status: AssignmentStatus;
    url: string | null;
    kind: string | null;
    description: string | null;
    attachments: string | null;
  }[];
  return rows.map(({ due_at, attachments, ...row }) => ({
    ...row,
    dueAt: due_at,
    attachments: attachments ? (JSON.parse(attachments) as string[]) : [],
  }));
}

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

async function readJson(
  req: Request,
): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Only pages of the university's own sites may be handed to the browser. */
export function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "zju.edu.cn" || url.hostname.endsWith(".zju.edu.cn"))
    );
  } catch {
    return false;
  }
}

type IdRequest = Bun.BunRequest<"/api/assignments/:id">;

function parseId(req: IdRequest): number | undefined {
  return /^\d+$/.test(req.params.id) ? Number(req.params.id) : undefined;
}

export const assignmentRoutes = {
  /**
   * Opens a page in the user's default browser. The app window shows only
   * studyPal itself, so links to the course platform go through here.
   */
  "/api/open-external": {
    POST: guarded(async (req: Request) => {
      const body = await readJson(req);
      if (!isOpenableUrl(body?.url)) return bad("只能打开浙大站点的链接");
      // The URL is passed as a single argument; no shell is involved.
      const child = Bun.spawn(["/usr/bin/open", body.url], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await child.exited) === 0
        ? Response.json({ ok: true })
        : bad("无法打开浏览器", 500);
    }),
  },

  "/api/assignments": {
    GET: guarded(() => Response.json(listAssignments(getDb()))),

    POST: guarded(async (req: Request) => {
      const body = await readJson(req);
      if (!body) return bad("请求内容不是有效的 JSON");
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return bad("标题不能为空");
      const course =
        typeof body.course === "string" && body.course.trim()
          ? body.course.trim()
          : null;

      let dueAt: string | null = null;
      if (
        body.dueAt !== undefined &&
        body.dueAt !== null &&
        body.dueAt !== ""
      ) {
        const due = new Date(String(body.dueAt));
        if (Number.isNaN(due.getTime())) return bad("截止时间无效");
        dueAt = due.toISOString();
      }

      const result = getDb()
        .query(
          "INSERT INTO assignments (source, course, title, due_at) VALUES ('manual', ?, ?, ?)",
        )
        .run(course, title, dueAt);
      scheduleSystemCalendarPush(getDb());
      return Response.json(
        { id: Number(result.lastInsertRowid) },
        { status: 201 },
      );
    }),
  },

  "/api/assignments/:id": {
    PATCH: guarded(async (req: IdRequest) => {
      const id = parseId(req);
      const body = await readJson(req);
      const status = body?.status as AssignmentStatus | undefined;
      if (id === undefined || !status || !STATUSES.includes(status)) {
        return bad("需要有效的作业编号和状态");
      }
      const result = getDb()
        .query(
          "UPDATE assignments SET status = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(status, id);
      if (result.changes === 0) return bad("作业不存在", 404);
      scheduleSystemCalendarPush(getDb());
      return Response.json({ ok: true });
    }),

    /** Only items the user added can be deleted; synced ones would come back. */
    DELETE: guarded((req: IdRequest) => {
      const id = parseId(req);
      if (id === undefined) return bad("无效的作业编号");
      const row = getDb()
        .query("SELECT source FROM assignments WHERE id = ?")
        .get(id) as {
        source: string;
      } | null;
      if (!row) return bad("作业不存在", 404);
      if (row.source !== "manual")
        return bad("同步来的作业不能删除，可以标记为忽略", 409);
      getDb().query("DELETE FROM assignments WHERE id = ?").run(id);
      scheduleSystemCalendarPush(getDb());
      return Response.json({ ok: true });
    }),
  },
};
