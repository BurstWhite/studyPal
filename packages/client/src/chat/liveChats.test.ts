import { afterEach, expect, test } from "bun:test";
import {
  chatView,
  forgetChat,
  onTurnFinished,
  sendMessage,
  showStored,
} from "./liveChats";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A turn's event stream whose events are released one by one. */
function controlledTurn() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  globalThis.fetch = (async () =>
    new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    })) as unknown as typeof fetch;
  return {
    emit: (event: unknown) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    end: () => controller.close(),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a turn keeps its progress while its chat is not on screen", async () => {
  const turn = controlledTurn();
  let finished = 0;
  const stop = onTurnFinished(() => finished++);

  const sending = sendMessage(101, "你好");
  expect(chatView(101)).toMatchObject({
    running: true,
    items: [{ type: "user", text: "你好" }],
  });

  turn.emit({ type: "text", delta: "在" });
  await tick();
  // Coming back to the chat loads what the server has stored, which does not
  // include the turn yet; that must not wipe what is on screen.
  showStored(101, []);
  expect(chatView(101)!.items).toEqual([
    { type: "user", text: "你好" },
    { type: "assistant", text: "在" },
  ]);

  const stored = [
    { type: "user" as const, text: "你好" },
    { type: "assistant" as const, text: "在的" },
  ];
  turn.emit({ type: "done", items: stored });
  turn.end();
  await sending;
  expect(chatView(101)).toMatchObject({ running: false, items: stored });
  expect(finished).toBe(1);

  // A load that started before the turn ended cannot roll it back either.
  showStored(101, []);
  expect(chatView(101)!.items).toEqual(stored);
  stop();
  forgetChat(101);
});

test("a failed turn hands its message back, even if the chat was closed", async () => {
  const turn = controlledTurn();
  showStored(102, [{ type: "user", text: "早" }]);
  const sending = sendMessage(102, "再试一次");
  turn.emit({ type: "error", message: "API key 无效" });
  turn.end();
  await sending;
  expect(chatView(102)).toMatchObject({
    running: false,
    problem: "API key 无效",
    returnedDraft: "再试一次",
    items: [{ type: "user", text: "早" }],
  });
  forgetChat(102);
});

test("the first load of a chat is shown", () => {
  showStored(103, [{ type: "user", text: "hi" }]);
  expect(chatView(103)!.items).toEqual([{ type: "user", text: "hi" }]);
  forgetChat(103);
  expect(chatView(103)).toBeUndefined();
});
