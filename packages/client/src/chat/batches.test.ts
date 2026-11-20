import { expect, test } from "bun:test";
import { groupPending } from "./batches";
import type { LiveItem } from "./liveChats";

const tool = (id: string, name: string, awaiting = true): LiveItem => ({
  type: "tool",
  id,
  name,
  input: {},
  awaiting,
});

test("pending calls of one tool fold into a batch", () => {
  const entries = groupPending([
    { type: "user", text: "hi" },
    tool("a", "create_event"),
    tool("b", "create_event"),
    tool("c", "create_event"),
  ]);
  expect(entries.map((e) => e.type)).toEqual(["item", "batch"]);
  const batch = entries[1]!;
  expect(batch.type === "batch" && batch.tools.map((t) => t.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("a single call, other tools and answered calls stay apart", () => {
  const entries = groupPending([
    tool("a", "create_event"),
    tool("b", "set_reminders"),
    tool("c", "set_reminders", false),
    tool("d", "set_reminders"),
  ]);
  expect(entries.every((e) => e.type === "item")).toBe(true);
});
