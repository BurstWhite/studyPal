import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, Plus, Send, Trash2, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import type { ChatSummary, Provider } from "../server/llm/store";
import type { DisplayItem } from "../server/llm/turn";
import type { StreamEvent } from "../server/routes/chat";
import { DECLINED_MESSAGE } from "../shared/chat";
import { cn } from "../lib/utils";
import { api, useQuery } from "./api";
import { takePrompt } from "./chat/pendingPrompt";
import { summarizeTool } from "./chat/toolSummary";

/** A tool call as shown while its turn is still running. */
type LiveTool = Extract<DisplayItem, { type: "tool" }> & {
  /** Waiting for the user to approve or decline. */
  awaiting?: boolean;
  declined?: boolean;
};
export type LiveItem = Exclude<DisplayItem, { type: "tool" }> | LiveTool;

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

const markdownClass =
  "text-sm leading-relaxed [&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:underline [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground";

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

/** Three pulsing dots in a reply bubble, shown until the first words arrive. */
function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label="正在回复"
      className="flex items-center gap-1 self-start rounded-2xl bg-muted px-4 py-3"
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="typing-dot size-2 rounded-full bg-muted-foreground"
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
    </div>
  );
}

function ToolRow({
  item,
  onDecision,
}: {
  item: LiveTool;
  onDecision: (id: string, approve: boolean) => void;
}) {
  const summary = summarizeTool(item.name, item.input);
  const failed = item.result && !item.result.ok;
  // After a reload only the stored result says that the user declined.
  const declined = item.declined || item.result?.content === DECLINED_MESSAGE;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        item.awaiting ? "border-ring bg-accent/40" : "bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{summary.label}</span>
        <span className="flex-1" />
        {item.awaiting ? (
          <span className="text-xs text-muted-foreground">等待你确认</span>
        ) : !item.result ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : declined ? (
          <span className="text-xs text-muted-foreground">已拒绝</span>
        ) : failed ? (
          <span className="text-xs text-destructive">未成功</span>
        ) : (
          <Check className="size-3.5 text-muted-foreground" />
        )}
      </div>
      {summary.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-5.5 text-xs text-muted-foreground">
          {summary.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {failed && !declined && (
        <p className="mt-1 pl-5.5 text-xs text-destructive">
          {item.result!.content}
        </p>
      )}
      {item.awaiting && (
        <div className="mt-2 flex gap-2 pl-5.5">
          <Button size="sm" onClick={() => onDecision(item.id, true)}>
            <Check />
            确认
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecision(item.id, false)}
          >
            <X />
            拒绝
          </Button>
        </div>
      )}
    </div>
  );
}

function Conversation({
  chatId,
  initialMessage,
  onTurnFinished,
}: {
  chatId: number;
  /** Sent automatically once the conversation has loaded. */
  initialMessage?: string;
  onTurnFinished: () => void;
}) {
  const { data, error } = useQuery<{ chat: ChatSummary; items: DisplayItem[] }>(
    `/api/chats/${chatId}`,
  );
  const [items, setItems] = useState<LiveItem[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data) setItems(data.items);
  }, [data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items, thinking]);

  const updateTool = (id: string, change: Partial<LiveTool>) =>
    setItems((current) =>
      current.map((item) =>
        item.type === "tool" && item.id === id ? { ...item, ...change } : item,
      ),
    );

  const decide = (id: string, approve: boolean) => {
    updateTool(id, { awaiting: false });
    api(`/api/chat-approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ approve }),
    }).catch((reason: unknown) =>
      setProblem(reason instanceof Error ? reason.message : String(reason)),
    );
  };

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || running) return;
    const before = items;
    setDraft("");
    setProblem(undefined);
    setRunning(true);
    setItems([...before, { type: "user", text }]);

    // A failed turn is not saved, so put the message back for another try.
    const fail = (message: string) => {
      setItems(before);
      setDraft(text);
      setProblem(message);
    };

    try {
      const response = await fetch(`/api/chats/${chatId}/messages`, {
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
            setThinking(true);
            break;
          case "text":
            setThinking(false);
            setItems((current) => {
              const last = current.at(-1);
              return last?.type === "assistant"
                ? [
                    ...current.slice(0, -1),
                    { type: "assistant", text: last.text + event.delta },
                  ]
                : [...current, { type: "assistant", text: event.delta }];
            });
            break;
          case "tool_call":
            setThinking(false);
            setItems((current) => [
              ...current,
              {
                type: "tool",
                id: event.id,
                name: event.name,
                input: event.input,
                awaiting: event.needsApproval,
              },
            ]);
            break;
          case "tool_result":
            updateTool(event.id, {
              awaiting: false,
              declined: event.declined,
              result: { ok: event.ok, content: "" },
            });
            break;
          case "done":
            finished = true;
            setItems(event.items);
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
      setRunning(false);
      setThinking(false);
      onTurnFinished();
    }
  };

  const sentInitial = useRef(false);
  useEffect(() => {
    if (data && initialMessage && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialMessage);
    }
    // Runs once, when the conversation first loads.
  }, [data, initialMessage]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  };

  const unavailable = data?.chat.providerId === null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              无法读取对话：{error}
            </p>
          )}
          {data && items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              可以问「这周还有哪些作业没交」，或者让它「把数据结构实验拆成几个学习块排进这周」。
            </p>
          )}
          {items.map((item, index) =>
            item.type === "user" ? (
              <div
                key={index}
                className="max-w-[80%] self-end whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                {item.text}
              </div>
            ) : item.type === "assistant" ? (
              <div key={index} className={markdownClass}>
                <Markdown>{item.text}</Markdown>
              </div>
            ) : (
              <ToolRow key={item.id} item={item} onDecision={decide} />
            ),
          )}
          {isWaitingForReply(items, running, thinking) && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t px-6 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {unavailable ? (
            <p className="text-sm text-muted-foreground">
              这段对话使用的模型服务已被删除，只能查看。请新建对话继续。
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="消息"
                rows={2}
                placeholder="输入消息，Enter 发送，Shift + Enter 换行"
                className="max-h-40 min-h-0 resize-none"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
              <Button
                size="icon"
                aria-label="发送"
                disabled={running || !draft.trim()}
                onClick={() => void send()}
              >
                {running ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const providers = useQuery<Provider[]>("/api/providers");
  const chats = useQuery<ChatSummary[]>("/api/chats");
  const [activeId, setActiveId] = useState<number>();
  const [providerId, setProviderId] = useState<number>();
  const [problem, setProblem] = useState<string>();
  /** A message handed over by another page, and the chat created to send it. */
  const [handoff, setHandoff] = useState<{ text: string; chatId?: number }>();
  const startedHandoff = useRef(false);

  useEffect(() => {
    const text = takePrompt();
    if (text) setHandoff({ text });
  }, []);

  const defaultProvider =
    providers.data?.find((provider) => provider.isDefault) ??
    providers.data?.[0];
  const chosenProvider =
    providers.data?.find((provider) => provider.id === providerId) ??
    defaultProvider;

  // Open the most recent chat when the page loads, unless a handed-over
  // message is about to start a new one.
  useEffect(() => {
    if (activeId === undefined && !handoff && chats.data?.[0])
      setActiveId(chats.data[0].id);
  }, [chats.data, activeId, handoff]);

  // A handed-over message starts a new chat with the default provider.
  useEffect(() => {
    if (
      !handoff ||
      handoff.chatId !== undefined ||
      !defaultProvider ||
      startedHandoff.current
    )
      return;
    startedHandoff.current = true;
    api<{ id: number }>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ providerId: defaultProvider.id }),
    })
      .then(({ id }) => {
        setHandoff({ text: handoff.text, chatId: id });
        setActiveId(id);
        chats.reload();
      })
      .catch((reason: unknown) =>
        setProblem(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [handoff, defaultProvider]);

  const create = async () => {
    if (!chosenProvider) return;
    setProblem(undefined);
    try {
      const { id } = await api<{ id: number }>("/api/chats", {
        method: "POST",
        body: JSON.stringify({ providerId: chosenProvider.id }),
      });
      setActiveId(id);
      chats.reload();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = async (id: number) => {
    setProblem(undefined);
    try {
      await api(`/api/chats/${id}`, { method: "DELETE" });
      if (activeId === id) setActiveId(undefined);
      chats.reload();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const loadError = providers.error ?? chats.error;
  const noProviders = providers.data?.length === 0;

  return (
    // Cancel the page padding so the conversation can use the full height.
    <div className="-m-6 flex h-[calc(100%+3rem)]">
      <aside className="flex w-56 shrink-0 flex-col border-r">
        <div className="flex flex-col gap-2 border-b p-3">
          {providers.data && providers.data.length > 1 && (
            <select
              aria-label="新对话使用的模型服务"
              className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
              value={chosenProvider?.id}
              onChange={(event) => setProviderId(Number(event.target.value))}
            >
              {providers.data.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            disabled={!chosenProvider}
            onClick={() => void create()}
          >
            <Plus />
            新对话
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {chats.data?.map((chat) => (
            <li key={chat.id} className="group relative">
              <button
                type="button"
                onClick={() => setActiveId(chat.id)}
                aria-current={chat.id === activeId ? "true" : undefined}
                className={cn(
                  "w-full truncate rounded-md py-1.5 pl-2 pr-8 text-left text-sm",
                  chat.id === activeId
                    ? "bg-accent font-medium"
                    : "hover:bg-accent/60",
                )}
              >
                {chat.title || "新对话"}
              </button>
              <button
                type="button"
                aria-label={`删除对话 ${chat.title || "新对话"}`}
                onClick={() => void remove(chat.id)}
                className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block focus-visible:block"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {(loadError ?? problem) && (
          <p role="alert" className="px-6 pt-4 text-sm text-destructive">
            {loadError ? `无法读取数据：${loadError}` : problem}
          </p>
        )}
        {noProviders ? (
          <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            还没有可用的模型服务。先到
            <a href="#/settings" className="mx-1 underline">
              设置
            </a>
            里添加一个（需要 API key），再回来开始对话。
          </div>
        ) : activeId !== undefined ? (
          <Conversation
            key={activeId}
            chatId={activeId}
            initialMessage={
              handoff?.chatId === activeId ? handoff.text : undefined
            }
            onTurnFinished={chats.reload}
          />
        ) : (
          providers.data && (
            <div className="m-auto text-center text-sm text-muted-foreground">
              点左上角的「新对话」开始。
            </div>
          )
        )}
      </section>
    </div>
  );
}
