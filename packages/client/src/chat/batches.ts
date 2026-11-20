import type { LiveItem, LiveTool } from "./liveChats";

/** Consecutive tool calls of one kind that are all waiting for an answer. */
export interface Batch {
  type: "batch";
  tools: LiveTool[];
  /** Index in the original list of the first call, for keys. */
  start: number;
}

export type Entry =
  { type: "item"; item: LiveItem; index: number } | (Batch & {});

/**
 * Folds runs of two or more pending calls to the same tool (say, five
 * "添加日程" cards in a row) into one batch that can be answered at once.
 * Everything else stays as it is.
 */
export function groupPending(items: LiveItem[]): Entry[] {
  const entries: Entry[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (item.type !== "tool" || !item.awaiting) {
      entries.push({ type: "item", item, index });
      continue;
    }
    const tools: LiveTool[] = [item];
    while (index + 1 < items.length) {
      const next = items[index + 1]!;
      if (next.type !== "tool" || !next.awaiting || next.name !== item.name)
        break;
      tools.push(next);
      index++;
    }
    if (tools.length === 1) entries.push({ type: "item", item, index });
    else
      entries.push({ type: "batch", tools, start: index - tools.length + 1 });
  }
  return entries;
}
