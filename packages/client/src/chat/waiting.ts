import type { LiveItem } from "./liveChats";

/**
 * Whether the assistant is working but has nothing on screen yet: right after
 * a message is sent, after tool results go back, or while it is thinking.
 */
export function isWaitingForReply(
  items: LiveItem[],
  running: boolean,
  thinking: boolean,
): boolean {
  if (!running) return false;
  // A card waiting for the user's decision means the wait is on them.
  if (items.some((item) => item.type === "tool" && item.awaiting)) return false;
  if (thinking) return true;
  const last = items.at(-1);
  if (!last || last.type === "user") return true;
  // A finished tool call: the results are with the model now. A tool still
  // running shows its own spinner, and streaming text speaks for itself.
  return last.type === "tool" && last.result !== undefined;
}
