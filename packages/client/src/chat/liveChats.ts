/**
 * What each chat shows, kept outside the chat view. A turn keeps streaming
 * into here while the user looks at another chat or page, so coming back
 * shows it where it is, and its approval cards are still there to answer.
 * The server only stores a turn once it has finished, so before then this
 * is the only place its progress exists.
 */
import { useSyncExternalStore } from "react";
import type { DisplayItem } from "@studypal/core/llm/turn";
import type { StreamEvent } from "@studypal/core/routes/chat";
import { api } from "../api";
import { request } from "../transport";

/** A tool call as shown while its turn is still running. */
export type LiveTool = Extract<DisplayItem, { type: "tool" }> & {
  /** Waiting for the user to approve or decline. */
  awaiting?: boolean;
  declined?: boolean;
};
export type LiveItem = Exclude<DisplayItem, { type: "tool" }> | LiveTool;

export interface ChatView {
  items: LiveItem[];
  running: boolean;
  thinking: boolean;
  problem?: string;
  /** A message whose turn failed, to put back in the input box. */
  returnedDraft?: string;
}

const EMPTY: ChatView = { items: [], running: false, thinking: false };

const views = new Map<number, ChatView>();
const listeners = new Set<() => void>();
const finishListeners = new Set<() => void>();
let running: number[] = [];

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(
  chatId: number,
  change: Partial<ChatView> | ((view: ChatView) => Partial<ChatView>),
): void {
  const current = views.get(chatId) ?? EMPTY;
  const next = {
    ...current,
    ...(typeof change === "function" ? change(current) : change),
  };
  views.set(chatId, next);
  if (next.running !== current.running) {
    running = [...views].filter(([, view]) => view.running).map(([id]) => id);
  }
  for (const listener of listeners) listener();
}

/** The chat's view right now, outside React. */
export function chatView(chatId: number): ChatView | undefined {
  return views.get(chatId);
}

/** The chat's view; undefined until it has been loaded or used. */
export function useChatView(chatId: number): ChatView | undefined {
  return useSyncExternalStore(subscribe, () => views.get(chatId));
}

/** Ids of the chats with a turn in progress. */
export function useRunningChats(): number[] {
  return useSyncExternalStore(subscribe, () => running);
}

/** Calls `listener` whenever any chat's turn ends, however it ends. */
export function onTurnFinished(listener: () => void): () => void {
  finishListeners.add(listener);
  return () => finishListeners.delete(listener);
}

/**
 * Shows what the server has stored for a chat seen for the first time.
 * After that this store is ahead of the server (it has the turn in progress,
 * or the one that just ended), so a later load must not overwrite it.
 */
export function showStored(chatId: number, items: DisplayItem[]): void {
  if (!views.has(chatId)) update(chatId, { items });
}

export function setProblem(chatId: number, problem: string | undefined): void {
  update(chatId, { problem });
}

export function takeReturnedDraft(chatId: number): void {
  update(chatId, { returnedDraft: undefined });
}

/** For a deleted chat, whose id may later be given to a new one. */
export function forgetChat(chatId: number): void {
  views.delete(chatId);
  for (const listener of listeners) listener();
}

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

function updateTool(chatId: number, id: string, change: Partial<LiveTool>) {
  update(chatId, (view) => ({
    items: view.items.map((item) =>
      item.type === "tool" && item.id === id ? { ...item, ...change } : item,
    ),
  }));
}

/** The user's answer to a write the assistant wants to make. */
export function decide(chatId: number, id: string, approve: boolean): void {
  updateTool(chatId, id, { awaiting: false });
  api(`/api/chat-approvals/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ approve }),
  }).catch((reason: unknown) => setProblem(chatId, message(reason)));
}

/** One answer for a whole batch of writes. */
export function decideAll(chatId: number, ids: string[], approve: boolean) {
  for (const id of ids) decide(chatId, id, approve);
}

/** Reads a `text/event-stream` body and yields each event's JSON payload. */
async function* readEvents(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data: "))
          yield JSON.parse(line.slice(6)) as StreamEvent;
      }
    }
  }
}

/** Sends a message and streams the turn into the chat's view. */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  const before = (views.get(chatId) ?? EMPTY).items;
  if (views.get(chatId)?.running) return;
  update(chatId, {
    items: [...before, { type: "user", text }],
    running: true,
    thinking: false,
    problem: undefined,
  });

  // A failed turn is not saved, so put the message back for another try.
  const fail = (problem: string) => {
    if (views.has(chatId))
      update(chatId, { items: before, problem, returnedDraft: text });
  };

  try {
    const response = await request(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      fail(body?.error ?? `请求失败（HTTP ${response.status}）`);
      return;
    }

    let finished = false;
    for await (const event of readEvents(response)) {
      switch (event.type) {
        case "thinking":
          update(chatId, { thinking: true });
          break;
        case "text":
          update(chatId, (view) => {
            const last = view.items.at(-1);
            return {
              thinking: false,
              items:
                last?.type === "assistant"
                  ? [
                      ...view.items.slice(0, -1),
                      { type: "assistant", text: last.text + event.delta },
                    ]
                  : [...view.items, { type: "assistant", text: event.delta }],
            };
          });
          break;
        case "tool_call":
          update(chatId, (view) => ({
            thinking: false,
            items: [
              ...view.items,
              {
                type: "tool",
                id: event.id,
                name: event.name,
                input: event.input,
                awaiting: event.needsApproval,
              },
            ],
          }));
          break;
        case "tool_result":
          updateTool(chatId, event.id, {
            awaiting: false,
            declined: event.declined,
            result: { ok: event.ok, content: "" },
          });
          break;
        case "done":
          finished = true;
          update(chatId, { items: event.items });
          break;
        case "error":
          finished = true;
          fail(event.message);
          break;
      }
    }
    if (!finished) fail("连接中断了，这条消息没有处理完，请重试。");
  } catch {
    fail("连接中断了，这条消息没有处理完，请重试。");
  } finally {
    // A chat deleted mid-turn has nothing left to show.
    if (views.has(chatId)) update(chatId, { running: false, thinking: false });
    for (const listener of finishListeners) listener();
  }
}
