/**
 * Route tables shared by both apps. The desktop hands them to `Bun.serve`;
 * the phone has no server and dispatches requests to them in-process with
 * `createRouter`.
 */

/** `{ id: string }` for `"/api/chats/:id"`, as `Bun.serve` provides. */
export type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param]: string } & RouteParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<never, string>;

export type RouteRequest<Path extends string = string> = Request & {
  params: RouteParams<Path>;
};

export type Handler = (req: any) => Response | Promise<Response>;

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Routes = Record<string, Partial<Record<Method, Handler>>>;

interface CompiledRoute {
  pattern: RegExp;
  names: string[];
  methods: Partial<Record<Method, Handler>>;
  /** More literal segments win, as in `Bun.serve`. */
  score: number;
}

function compile(path: string, methods: Partial<Record<Method, Handler>>) {
  const names: string[] = [];
  let score = 0;
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      score++;
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { pattern: new RegExp(`^${source}$`), names, methods, score };
}

/** Dispatches requests to `routes` without a server. Unknown paths get 404. */
export function createRouter(
  routes: Routes,
): (req: Request) => Promise<Response> {
  const compiled: CompiledRoute[] = Object.entries(routes)
    .map(([path, methods]) => compile(path, methods))
    .sort((a, b) => b.score - a.score);

  return async (req) => {
    const { pathname } = new URL(req.url);
    for (const route of compiled) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const handler = route.methods[req.method.toUpperCase() as Method];
      if (!handler) {
        return Response.json({ error: "method not allowed" }, { status: 405 });
      }
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]!);
      });
      return handler(Object.assign(req, { params }));
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
}
