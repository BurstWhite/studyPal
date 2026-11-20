import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import path from "node:path";
import { createRouter, type RouteRequest } from "./router";

describe("createRouter", () => {
  const route = createRouter({
    "/api/chats": { GET: () => Response.json("list") },
    "/api/chats/clear": { POST: () => Response.json("clear") },
    "/api/chats/:id": {
      GET: (req: RouteRequest<"/api/chats/:id">) =>
        Response.json({ id: req.params.id }),
    },
    "/api/chats/:id/messages/:index": {
      POST: (req: RouteRequest<"/api/chats/:id/messages/:index">) =>
        Response.json(req.params),
    },
  });
  const call = async (method: string, url: string) => {
    const response = await route(
      new Request(`http://studypal.local${url}`, { method }),
    );
    return { status: response.status, body: await response.json() };
  };

  test("matches literal paths and fills params", async () => {
    expect(await call("GET", "/api/chats")).toEqual({
      status: 200,
      body: "list",
    });
    expect(await call("GET", "/api/chats/12?x=1")).toEqual({
      status: 200,
      body: { id: "12" },
    });
    expect(await call("POST", "/api/chats/3/messages/%E4%B8%80")).toEqual({
      status: 200,
      body: { id: "3", index: "一" },
    });
  });

  test("a literal segment wins over a parameter", async () => {
    expect((await call("POST", "/api/chats/clear")).body).toBe("clear");
  });

  test("unknown paths and methods", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("DELETE", "/api/chats")).status).toBe(405);
  });
});

test("core imports nothing that only Bun or Node provides", async () => {
  const root = import.meta.dir;
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.ts").scan({ cwd: root })) {
    if (file.endsWith(".test.ts") || file.startsWith("testing/")) continue;
    const source = await Bun.file(path.join(root, file)).text();
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const pattern of [
      /from "bun(:\w+)?"/,
      /from "node:/,
      /\bBun\./,
      /\bBuffer\./,
      /\bprocess\./,
    ]) {
      if (pattern.test(code)) offenders.push(`${file}: ${pattern}`);
    }
  }
  expect(offenders).toEqual([]);
});
