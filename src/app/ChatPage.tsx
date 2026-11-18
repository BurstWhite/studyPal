import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import type { ModelList } from "../server/llm/models";
import type { ChatSummary, Provider, ProviderKind } from "../server/llm/store";
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

/** The assistant's mark, shown where one of its replies begins. */
function AssistantMark() {
  return (
    <span
      aria-hidden
      className="absolute left-0 top-0 grid size-7 place-items-center rounded-full bg-secondary text-primary"
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/** Three pulsing dots in a reply bubble, shown until the first words arrive. */
function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label="正在回复"
      className="flex items-center gap-1 self-start rounded-2xl rounded-tl-md bg-muted px-4 py-3"
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
        "rounded-xl border px-3.5 py-2.5 text-sm",
        item.awaiting ? "border-primary/40 bg-secondary/60" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <Wrench className="size-3.5 shrink-0 text-primary" />
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
          <Check className="size-3.5 text-primary" />
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
        <div className="mt-3 flex gap-2 pl-5.5">
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

/**
 * Whether a chat's stored history can be replayed to another provider: every
 * kind but Anthropic speaks the OpenAI chat-completions format.
 */
const sameWireFormat = (a: ProviderKind | undefined, b: ProviderKind) =>
  a !== undefined && (a === "anthropic") === (b === "anthropic");

/** A provider and one of its models, as chosen in the picker. */
export interface ModelChoice {
  providerId: number;
  model: string;
}

const choiceKey = (choice: ModelChoice) =>
  `${choice.providerId}:${choice.model}`;

/** The model a chat talks to: its own choice, else its provider's default. */
function currentModel(
  chat: ChatSummary,
  providers: Provider[],
): string | undefined {
  return (
    chat.model ??
    providers.find((provider) => provider.id === chat.providerId)?.model
  );
}

/** Every model of every provider, grouped by provider. */
function ModelPicker({
  providers,
  lists,
  value,
  disabled,
  onChange,
}: {
  providers: Provider[];
  lists: ModelList[] | undefined;
  value: ModelChoice | undefined;
  disabled: boolean;
  onChange: (choice: ModelChoice) => void;
}) {
  const options = providers.map((provider) => {
    const list = lists?.find((entry) => entry.providerId === provider.id);
    // The configured model, and the one in use, are always offered even if
    // the service does not list them (or the list could not be fetched).
    const models = [...(list?.models ?? [])];
    for (const extra of [
      provider.model,
      value?.providerId === provider.id ? value.model : undefined,
    ]) {
      if (extra && !models.includes(extra)) models.unshift(extra);
    }
    return { provider, models, error: list?.error };
  });

  return (
    <div className="relative inline-flex items-center">
      <select
        aria-label="对话使用的模型"
        className="h-8 max-w-[22rem] appearance-none truncate rounded-lg border bg-card py-0 pl-3 pr-8 text-sm font-medium outline-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
        disabled={disabled}
        value={value ? choiceKey(value) : ""}
        onChange={(event) => {
          const [id, ...rest] = event.target.value.split(":");
          onChange({ providerId: Number(id), model: rest.join(":") });
        }}
      >
        {!value && <option value="">选择模型</option>}
        {options.map(({ provider, models, error }) => (
          <optgroup
            key={provider.id}
            label={
              error ? `${provider.name}（模型列表获取失败）` : provider.name
            }
          >
            {models.map((model) => (
              <option
                key={model}
                value={choiceKey({ providerId: provider.id, model })}
              >
                {model}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" />
      {!lists && (
        <Loader2
          aria-label="正在获取模型列表"
          className="ml-2 size-3.5 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}

/** Asks what to do with the conversation so far before changing model. */
function SwitchPrompt({
  from,
  to,
  canKeep,
  onReset,
  onKeep,
  onCancel,
}: {
  from: string | undefined;
  to: string;
  canKeep: boolean;
  onReset: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="切换模型"
      className="rounded-xl border border-primary/40 bg-secondary/60 px-4 py-3 text-sm"
    >
      <p className="font-medium">
        切换到 {to}
        {from ? `（当前是 ${from}）` : ""}
      </p>
      <p className="mt-1 text-muted-foreground">
        {canKeep
          ? "建议重置上下文：会开一个新对话让新模型从头开始，这段对话仍保留在左侧列表里。也可以把现有上下文交给新模型继续，但前面的回复是别的模型写的，效果可能不稳定。"
          : "这个模型使用另一种消息格式，读不了这段对话的上下文，只能重置：会开一个新对话，这段对话仍保留在左侧列表里。"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onReset}>
          <RotateCcw />
          重置上下文并切换
        </Button>
        {canKeep && (
          <Button size="sm" variant="outline" onClick={onKeep}>
            保留上下文切换
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function Conversation({
  chatId,
  providers,
  modelLists,
  initialMessage,
  onTurnFinished,
  onReset,
}: {
  chatId: number;
  providers: Provider[];
  modelLists: ModelList[] | undefined;
  /** Sent automatically once the conversation has loaded. */
  initialMessage?: string;
  onTurnFinished: () => void;
  /** Starts a new chat with the given model, leaving this one as it is. */
  onReset: (choice: ModelChoice) => void;
}) {
  const { data, error } = useQuery<{ chat: ChatSummary; items: DisplayItem[] }>(
    `/api/chats/${chatId}`,
  );
  const [chat, setChat] = useState<ChatSummary>();
  const [pendingSwitch, setPendingSwitch] = useState<ModelChoice>();
  const [items, setItems] = useState<LiveItem[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data) {
      setItems(data.items);
      setChat(data.chat);
    }
  }, [data]);

  const activeModel = chat && currentModel(chat, providers);
  const activeChoice: ModelChoice | undefined =
    chat?.providerId != null && activeModel
      ? { providerId: chat.providerId, model: activeModel }
      : undefined;
  const providerOf = (id: number) =>
    providers.find((provider) => provider.id === id);

  const applySwitch = async (choice: ModelChoice) => {
    setPendingSwitch(undefined);
    setProblem(undefined);
    try {
      const result = await api<{ chat: ChatSummary }>(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify(choice),
      });
      setChat(result.chat);
      onTurnFinished();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const chooseModel = (choice: ModelChoice) => {
    if (activeChoice && choiceKey(choice) === choiceKey(activeChoice)) return;
    // Nothing said yet: there is no context to lose.
    if (items.length === 0) void applySwitch(choice);
    else setPendingSwitch(choice);
  };

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

  const unavailable = chat?.providerId === null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-8 py-2.5">
        <ModelPicker
          providers={providers}
          lists={modelLists}
          value={pendingSwitch ?? activeChoice}
          disabled={!chat || running}
          onChange={chooseModel}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              无法读取对话：{error}
            </p>
          )}
          {data && items.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="grid size-11 place-items-center rounded-2xl bg-secondary text-primary">
                <Sparkles className="size-5" />
              </span>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                可以问「这周还有哪些作业没交」，或者让它「把数据结构实验拆成几个学习块排进这周」。
              </p>
            </div>
          )}
          {items.map((item, index) => {
            // The assistant's mark sits beside the first part of each reply.
            const opensReply =
              item.type !== "user" &&
              items[index - 1]?.type !== "assistant" &&
              items[index - 1]?.type !== "tool";
            return item.type === "user" ? (
              <div
                key={index}
                className="mt-2 max-w-[80%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground"
              >
                {item.text}
              </div>
            ) : (
              <div
                key={item.type === "tool" ? item.id : index}
                className="relative pl-10"
              >
                {opensReply && <AssistantMark />}
                {item.type === "assistant" ? (
                  <div className={cn(markdownClass, "pt-1")}>
                    <Markdown>{item.text}</Markdown>
                  </div>
                ) : (
                  <ToolRow item={item} onDecision={decide} />
                )}
              </div>
            );
          })}
          {isWaitingForReply(items, running, thinking) && (
            <div className="relative flex pl-10">
              {items.at(-1)?.type === "user" && <AssistantMark />}
              <TypingIndicator />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-8 pb-5 pt-2">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {pendingSwitch && chat && (
            <SwitchPrompt
              from={activeModel}
              to={pendingSwitch.model}
              canKeep={sameWireFormat(
                providerOf(pendingSwitch.providerId)?.kind,
                chat.kind,
              )}
              onReset={() => {
                setPendingSwitch(undefined);
                onReset(pendingSwitch);
              }}
              onKeep={() => void applySwitch(pendingSwitch)}
              onCancel={() => setPendingSwitch(undefined)}
            />
          )}
          {unavailable ? (
            <p className="text-sm text-muted-foreground">
              这段对话使用的模型服务已被删除，只能查看。请新建对话，或在上方换一个模型继续。
            </p>
          ) : (
            <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 pl-1 transition-colors focus-within:border-primary/50">
              <Textarea
                aria-label="消息"
                rows={1}
                placeholder="输入消息，Enter 发送，Shift + Enter 换行"
                className="max-h-40 min-h-0 resize-none border-0 bg-transparent py-1.5 focus-visible:ring-0"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
              <Button
                size="icon-sm"
                className="rounded-full"
                aria-label="发送"
                disabled={running || !draft.trim()}
                onClick={() => void send()}
              >
                {running ? <Loader2 className="animate-spin" /> : <ArrowUp />}
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
  // The server keeps these warm in the background; this only reads them.
  const modelLists = useQuery<ModelList[]>("/api/models");
  const [activeId, setActiveId] = useState<number>();
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
  // A new chat starts on the model of the chat in view, else the default.
  const activeChat = chats.data?.find((chat) => chat.id === activeId);
  const activeProvider =
    activeChat?.providerId != null
      ? providers.data?.find(
          (provider) => provider.id === activeChat.providerId,
        )
      : undefined;
  const nextChoice: ModelChoice | undefined = activeProvider
    ? {
        providerId: activeProvider.id,
        model: activeChat?.model ?? activeProvider.model,
      }
    : defaultProvider && {
        providerId: defaultProvider.id,
        model: defaultProvider.model,
      };

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

  const create = async (choice = nextChoice) => {
    if (!choice) return;
    setProblem(undefined);
    try {
      const { id } = await api<{ id: number }>("/api/chats", {
        method: "POST",
        body: JSON.stringify(choice),
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
    <div className="-mx-8 -my-7 flex h-[calc(100%+3.5rem)]">
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <div className="flex flex-col gap-2 p-3 pt-6">
          <h1 className="px-1 pb-1 text-[22px] font-semibold tracking-tight">
            对话
          </h1>
          <Button
            size="sm"
            disabled={!nextChoice}
            onClick={() => void create()}
          >
            <Plus />
            新对话
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {chats.data?.map((chat) => (
            <li key={chat.id} className="group relative">
              <button
                type="button"
                onClick={() => setActiveId(chat.id)}
                aria-current={chat.id === activeId ? "true" : undefined}
                className={cn(
                  "w-full truncate rounded-lg py-2 pl-2.5 pr-8 text-left text-sm",
                  chat.id === activeId
                    ? "bg-card font-medium shadow-[0_0_0_1px_var(--border)]"
                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
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

      <section className="flex min-w-0 flex-1 flex-col bg-card">
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
        ) : activeId !== undefined && providers.data ? (
          <Conversation
            key={activeId}
            chatId={activeId}
            providers={providers.data}
            modelLists={modelLists.data}
            onReset={(choice) => void create(choice)}
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
