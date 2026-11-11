import { guarded } from "../auth";
import {
  clearEvents,
  countEvents,
  createEvent,
  deleteEvent,
  isClearScope,
  listEntries,
  parseEventInput,
  updateEvent,
  ValidationError,
  type WriteResult,
} from "../calendar/store";
import {
  pushNow,
  scheduleSystemCalendarPush,
  setSystemCalendarEnabled,
  systemCalendarStatus,
} from "../calendar/system";
import { getDb } from "../db";

const MAX_RANGE_DAYS = 400;

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function readInput(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("请求内容不是有效的 JSON");
  }
  return parseEventInput(body);
}

function writeResponse(result: WriteResult): Response {
  if (result === "ok") scheduleSystemCalendarPush(getDb());
  if (result === "not-found") {
    return Response.json({ error: "日程不存在" }, { status: 404 });
  }
  if (result === "read-only") {
    return Response.json(
      { error: "同步来的日程不能在这里修改" },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}

function parseId(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

async function handleValidation(
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ValidationError) return badRequest(error.message);
    throw error;
  }
}

export const eventRoutes = {
  "/api/events": {
    GET: guarded((req: Request) => {
      const params = new URL(req.url).searchParams;
      const from = new Date(params.get("from") ?? "");
      const to = new Date(params.get("to") ?? "");
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return badRequest("需要 from 和 to 两个时间参数");
      }
      const days = (to.getTime() - from.getTime()) / 86_400_000;
      if (days <= 0 || days > MAX_RANGE_DAYS) {
        return badRequest(`时间范围必须在 0 到 ${MAX_RANGE_DAYS} 天之间`);
      }
      return Response.json(listEntries(getDb(), from, to));
    }),
    POST: guarded((req: Request) =>
      handleValidation(async () => {
        const id = createEvent(getDb(), await readInput(req));
        scheduleSystemCalendarPush(getDb());
        return Response.json({ id }, { status: 201 });
      }),
    ),
  },

  "/api/events/:id": {
    PUT: guarded((req: Bun.BunRequest<"/api/events/:id">) =>
      handleValidation(async () => {
        const id = parseId(req.params.id);
        if (id === undefined) return badRequest("无效的日程编号");
        return writeResponse(updateEvent(getDb(), id, await readInput(req)));
      }),
    ),
    DELETE: guarded((req: Bun.BunRequest<"/api/events/:id">) => {
      const id = parseId(req.params.id);
      if (id === undefined) return badRequest("无效的日程编号");
      return writeResponse(deleteEvent(getDb(), id));
    }),
  },

  /** Bulk removal: how many events each scope holds, and clearing one. */
  "/api/events/clear": {
    GET: guarded(() => Response.json(countEvents(getDb()))),
    POST: guarded(async (req: Request) => {
      const body = (await req.json().catch(() => null)) as {
        scope?: unknown;
      } | null;
      if (!isClearScope(body?.scope))
        return badRequest("scope 必须是 manual、synced 或 all");
      const deleted = clearEvents(getDb(), body.scope);
      if (deleted > 0) scheduleSystemCalendarPush(getDb());
      return Response.json({ deleted });
    }),
  },

  /** Mirroring into the system calendar (EventKit). */
  "/api/system-calendar": {
    GET: guarded(() => Response.json(systemCalendarStatus(getDb()))),

    /** Switching it on pushes immediately, which is when macOS asks for access. */
    PUT: guarded(async (req: Request) => {
      const body = (await req.json().catch(() => null)) as {
        enabled?: unknown;
      } | null;
      if (typeof body?.enabled !== "boolean")
        return badRequest("需要 enabled 字段");
      setSystemCalendarEnabled(getDb(), body.enabled);
      if (body.enabled) await pushNow(getDb());
      return Response.json(systemCalendarStatus(getDb()));
    }),
  },

  /** Pushes on demand and reports the outcome. */
  "/api/system-calendar/push": {
    POST: guarded(async () => {
      await pushNow(getDb());
      return Response.json(systemCalendarStatus(getDb()));
    }),
  },
};
