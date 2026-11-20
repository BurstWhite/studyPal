import { timingSafeEqual } from "node:crypto";
import type { Routes } from "@studypal/core/router";
import { config } from "./config";

const COOKIE_NAME = "studypal_session";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Only loopback Host headers are accepted, which blocks DNS-rebinding pages. */
export function isLocalHost(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Whether this request may use the API. With no token configured (plain
 * `bun dev`) every loopback request is allowed.
 */
export function isAuthorized(req: Request, token = config.token): boolean {
  if (!isLocalHost(req)) return false;
  if (!token) return true;
  const cookie = readCookie(req, COOKIE_NAME);
  return cookie !== undefined && safeEqual(cookie, token);
}

/**
 * `/auth?token=…` is the first URL the desktop shell opens. It trades the
 * launch token for a cookie so the token does not stay in the address.
 */
export function handleAuth(req: Request, token = config.token): Response {
  if (!isLocalHost(req)) return new Response("Forbidden", { status: 403 });
  const given = new URL(req.url).searchParams.get("token") ?? "";
  if (token && !safeEqual(given, token)) {
    return new Response("Forbidden", { status: 403 });
  }
  // A different address on every launch, so the window cannot show a page it
  // cached from an older build of the app.
  const headers = new Headers({
    Location: `/?launch=${Date.now().toString(36)}`,
  });
  if (token) {
    headers.set(
      "Set-Cookie",
      `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`,
    );
  }
  return new Response(null, { status: 302, headers });
}

type Handler<R extends Request> = (req: R) => Response | Promise<Response>;

/** Wraps an API handler so it answers 401 unless the request is authorized. */
export function guarded<R extends Request>(
  handler: Handler<R>,
  token = config.token,
): Handler<R> {
  return (req) => {
    if (!isAuthorized(req, token)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return handler(req);
  };
}

/** The liveness probe stays open; every other API route needs the session. */
const UNGUARDED = new Set(["/api/health"]);

/** Applies `guarded` to every handler of a shared route table. */
export function guardAll<T extends Routes>(routes: T, token = config.token): T {
  return Object.fromEntries(
    Object.entries(routes).map(([path, methods]) => [
      path,
      UNGUARDED.has(path)
        ? methods
        : Object.fromEntries(
            Object.entries(methods).map(([method, handler]) => [
              method,
              guarded(handler!, token),
            ]),
          ),
    ]),
  ) as T;
}
