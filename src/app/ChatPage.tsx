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
import type { ModelList } from "@studypal/core/llm/models";
import type {
  ChatSummary,
  Provider,
  ProviderKind,
} from "@studypal/core/llm/store";
import type { DisplayItem } from "@studypal/core/llm/turn";
import { DECLINED_MESSAGE } from "@studypal/core/shared/chat";
import { cn } from "../lib/utils";
import { api, useQuery } from "@studypal/client/api";
import {
  decide,
  decideAll,
  forgetChat,
  onTurnFinished,
  sendMessage,
  setProblem,
  showStored,
  takeReturnedDraft,
  useChatView,
  useRunningChats,
  type ChatView,
  type LiveItem,
  type LiveTool,
} from "@studypal/client/chat/liveChats";
import { groupPending } from "@studypal/client/chat/batches";
import { takePrompt } from "@studypal/client/chat/pendingPrompt";
import { summarizeTool } from "@studypal/client/chat/toolSummary";
import {
  choiceKey,
  currentModel,
  modelOptions,
  sameWireFormat,
  type ModelChoice,
} from "@studypal/client/chat/models";
import { isWaitingForReply } from "@studypal/client/chat/waiting";

const markdownClass =
  "text-sm leading-relaxed [&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:underline [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground";

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

/** Several pending writes of one kind, folded so they are answered at once. */
function BatchRow({
  tools,
  onDecision,
}: {
  tools: LiveTool[];
  onDecision: (ids: string[], approve: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = summarizeTool(tools[0]!.name, tools[0]!.input).label;
  const ids = tools.map((tool) => tool.id);
  return (
    <div className="rounded-xl border border-primary/40 bg-secondary/60 px-3.5 py-2.5 text-sm">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <Wrench className="size-3.5 shrink-0 text-primary" />
        <span className="font-medium">
          {label}（{tools.length} 项）
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">等待你确认</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul className="mt-1 space-y-1 pl-5.5 text-xs text-muted-foreground">
          {tools.map((tool) => (
            <li key={tool.id}>
              {summarizeTool(tool.name, tool.input).lines.join(" · ") || label}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2 pl-5.5">
        <Button size="sm" onClick={() => onDecision(ids, true)}>
          <Check />
          全部确认
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecision(ids, false)}
        >
          <X />
          全部拒绝
        </Button>
      </div>
    </div>
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
  const options = modelOptions(providers, lists, value);

  return (
    <div className="relative inline-flex shrink-0 items-center">
      {!lists && (
        <Loader2
          aria-label="正在获取模型列表"
          className="mr-1 size-3.5 animate-spin text-muted-foreground"
        />
      )}
      <select
        aria-label="对话使用的模型"
        title="对话使用的模型"
        className="h-8 max-w-[15rem] appearance-none truncate rounded-full bg-transparent py-0 pl-3 pr-7 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 disabled:hover:bg-transparent"
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
      <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-muted-foreground" />
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

/** What a chat shows before it has loaded. */
const NO_VIEW: ChatView = { items: [], running: false, thinking: false };

function Conversation({
  chatId,
  providers,
  modelLists,
  initialMessage,
  onChatChanged,
  onReset,
}: {
  chatId: number;
  providers: Provider[];
  modelLists: ModelList[] | undefined;
  /** Sent automatically once the conversation has loaded. */
  initialMessage?: string;
  /** The chat's provider or model changed. */
  onChatChanged: () => void;
  /** Starts a new chat with the given model, leaving this one as it is. */
  onReset: (choice: ModelChoice) => void;
}) {
  const { data, error } = useQuery<{ chat: ChatSummary; items: DisplayItem[] }>(
    `/api/chats/${chatId}`,
  );
  const [chat, setChat] = useState<ChatSummary>();
  const [pendingSwitch, setPendingSwitch] = useState<ModelChoice>();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  // Turns live outside this view, so they carry on while another chat is open.
  const view = useChatView(chatId) ?? NO_VIEW;
  const { items, running, thinking, problem } = view;

  useEffect(() => {
    if (data) {
      showStored(chatId, data.items);
      setChat(data.chat);
    }
  }, [data, chatId]);

  // A turn that failed, maybe while another chat was open, gives its message back.
  useEffect(() => {
    if (view.returnedDraft === undefined) return;
    setDraft(view.returnedDraft);
    takeReturnedDraft(chatId);
  }, [view.returnedDraft, chatId]);

  const activeModel = chat && currentModel(chat, providers);
  const activeChoice: ModelChoice | undefined =
    chat?.providerId != null && activeModel
      ? { providerId: chat.providerId, model: activeModel }
      : undefined;
  const providerOf = (id: number) =>
    providers.find((provider) => provider.id === id);

  const applySwitch = async (choice: ModelChoice) => {
    setPendingSwitch(undefined);
    setProblem(chatId, undefined);
    try {
      const result = await api<{ chat: ChatSummary }>(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify(choice),
      });
      setChat(result.chat);
      onChatChanged();
    } catch (reason) {
      setProblem(
        chatId,
        reason instanceof Error ? reason.message : String(reason),
      );
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

  const send = (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || running) return;
    setDraft("");
    void sendMessage(chatId, text);
  };

  const sentInitial = useRef(false);
  useEffect(() => {
    if (data && initialMessage && !sentInitial.current) {
      sentInitial.current = true;
      send(initialMessage);
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
      send();
    }
  };

  const unavailable = chat?.providerId === null;

  // Sits in the message box, beside the send button.
  const picker = (
    <ModelPicker
      providers={providers}
      lists={modelLists}
      value={pendingSwitch ?? activeChoice}
      disabled={!chat || running}
      onChange={chooseModel}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
          {groupPending(items).map((entry) => {
            if (entry.type === "batch") {
              return (
                <div key={entry.tools[0]!.id} className="relative pl-10">
                  {items[entry.start - 1]?.type !== "assistant" &&
                    items[entry.start - 1]?.type !== "tool" && (
                      <AssistantMark />
                    )}
                  <BatchRow
                    tools={entry.tools}
                    onDecision={(ids, approve) =>
                      decideAll(chatId, ids, approve)
                    }
                  />
                </div>
              );
            }
            const { item, index } = entry;
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
                  <ToolRow
                    item={item}
                    onDecision={(id, approve) => decide(chatId, id, approve)}
                  />
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
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-muted-foreground">
                这段对话使用的模型服务已被删除，只能查看。请新建对话，或在右边换一个模型继续。
              </p>
              {picker}
            </div>
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
              {picker}
              <Button
                size="icon-sm"
                className="rounded-full"
                aria-label="发送"
                disabled={running || !draft.trim()}
                onClick={() => send()}
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

  // A finished turn retitles and reorders the list, whichever chat is open.
  const reloadChats = chats.reload;
  useEffect(() => onTurnFinished(reloadChats), [reloadChats]);
  const runningChats = useRunningChats();

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
      forgetChat(id);
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
              {runningChats.includes(chat.id) ? (
                <Loader2
                  aria-label="正在回复"
                  className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
                />
              ) : (
                <button
                  type="button"
                  aria-label={`删除对话 ${chat.title || "新对话"}`}
                  onClick={() => void remove(chat.id)}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block focus-visible:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
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
            onChatChanged={chats.reload}
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
