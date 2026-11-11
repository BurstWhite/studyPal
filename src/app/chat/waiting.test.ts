import { expect, test } from "bun:test";
import { isWaitingForReply, type LiveItem } from "../ChatPage";

const user: LiveItem = { type: "user", text: "帮我排一下" };
const text: LiveItem = { type: "assistant", text: "我来" };
const tool = (extra: object = {}): LiveItem => ({
  type: "tool",
  id: "t1",
  name: "list_events",
  input: {},
  ...extra,
});
const done = { result: { ok: true, content: "" } };

test("dots show from sending until the first words arrive", () => {
  expect(isWaitingForReply([user], true, false)).toBe(true);
  expect(isWaitingForReply([user, text], true, false)).toBe(false);
});

test("dots return while the model reads tool results", () => {
  // The tool is still running: it has its own spinner.
  expect(isWaitingForReply([user, tool()], true, false)).toBe(false);
  expect(isWaitingForReply([user, tool(done)], true, false)).toBe(true);
  expect(isWaitingForReply([user, tool(done), text], true, false)).toBe(false);
});

test("dots show while the model is thinking, even after some text", () => {
  expect(isWaitingForReply([user, text], true, true)).toBe(true);
});

test("no dots while the user has to approve something, or when idle", () => {
  expect(isWaitingForReply([user, tool({ awaiting: true })], true, true)).toBe(
    false,
  );
  expect(isWaitingForReply([user], false, false)).toBe(false);
  expect(isWaitingForReply([user, tool(done)], false, false)).toBe(false);
});
