import { guarded } from "../auth";
import { scheduleSystemCalendarPush } from "../calendar/system";
import { getDb } from "../db";
import {
  appendMessages,
  ChatUnavailable,
  createChat,
  createProvider,
  deleteChat,
  deleteProvider,
  displayMessages,
  getChat,
  getProvider,
  listChats,
  listProviders,
  loadMessages,
  openConversation,
  parseProviderInput,
  ProviderInputError,
  setDefaultProvider,
  updateProvider,
} from "../llm/store";
import { TOOLS } from "../llm/tools";
import {
  runTurn,
  TurnError,
  type DisplayItem,
  type TurnEvent,
} from "../llm/turn";

/** Everything sent to the browser over a turn's event stream. */
export type StreamEvent =
  | TurnEvent
  | { type: "done"; items: DisplayItem[] }
  | { type: "error"; message: string };

const TITLE_LENGTH = 30;
/** Keeps the connection from being closed as idle while the model thinks. */
const HEARTBEAT_MS = 5000;

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

function parseId(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null);
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

/** Approvals a running turn is waiting on, by tool call id. */
const pendingApprovals = new Map<string, (approved: boolean) => void>();
const runningChats = new Set<number>();

type ProviderRequest = Bun.BunRequest<"/api/providers/:id">;
type ChatRequest = Bun.BunRequest<"/api/chats/:id">;

function streamTurn(req: Request, chatId: number, text: string): Response {
  const db = getDb();
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const waiting = new Set<string>();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (open)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      };
      const heartbeat = setInterval(() => {
        if (open) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, HEARTBEAT_MS);

      // If the browser goes away, stop the model and decline anything pending.
      req.signal.addEventListener("abort", () => {
        open = false;
        abort.abort();
        for (const id of waiting) pendingApprovals.get(id)?.(false);
      });

      runningChats.add(chatId);
      try {
        const chat = getChat(db, chatId)!;
        const conversation = await openConversation(db, chat);
        const before = conversation.messages().length;
        conversation.addUser(text, new Date());

        await runTurn(
          db,
          conversation,
          TOOLS,
          send,
          (call) =>
            new Promise<boolean>((resolve) => {
              waiting.add(call.id);
              pendingApprovals.set(call.id, (approved) => {
                waiting.delete(call.id);
                pendingApprovals.delete(call.id);
                resolve(approved);
              });
            }),
          abort.signal,
        );

        // Only a turn that ran to completion is kept, so the stored history
        // never ends in a tool call without its result.
        appendMessages(
          db,
          chatId,
          conversation.messages().slice(before),
          text.slice(0, TITLE_LENGTH),
        );
        send({ type: "done", items: conversation.display() });
      } catch (error) {
        if (error instanceof TurnError || error instanceof ChatUnavailable) {
          send({ type: "error", message: error.message });
        } else {
          console.error("chat turn failed:", error);
          send({ type: "error", message: "处理这条消息时出错了，请重试。" });
        }
      } finally {
        runningChats.delete(chatId);
        clearInterval(heartbeat);
        // Tools may have changed the schedule even if the turn failed later.
        scheduleSystemCalendarPush(db);
        if (open) controller.close();
        open = false;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const chatRoutes = {
  "/api/providers": {
    GET: guarded(() => Response.json(listProviders(getDb()))),
    POST: guarded(async (req: Request) => {
      try {
        const id = await createProvider(
          getDb(),
          parseProviderInput(await readJson(req), true),
        );
        return Response.json({ id }, { status: 201 });
      } catch (error) {
        if (error instanceof ProviderInputError) return bad(error.message);
        throw error;
      }
    }),
  },

  "/api/providers/:id": {
    PUT: guarded(async (req: ProviderRequest) => {
      const id = parseId(req.params.id);
      if (id === undefined) return bad("无效的编号");
      try {
        const found = await updateProvider(
          getDb(),
          id,
          parseProviderInput(await readJson(req), false),
        );
        return found ? Response.json({ ok: true }) : bad("模型服务不存在", 404);
      } catch (error) {
        if (error instanceof ProviderInputError) return bad(error.message);
        throw error;
      }
    }),
    DELETE: guarded(async (req: ProviderRequest) => {
      const id = parseId(req.params.id);
      if (id === undefined) return bad("无效的编号");
      return (await deleteProvider(getDb(), id))
        ? Response.json({ ok: true })
        : bad("模型服务不存在", 404);
    }),
  },

  "/api/providers/:id/default": {
    POST: guarded((req: Bun.BunRequest<"/api/providers/:id/default">) => {
      const id = parseId(req.params.id);
      if (id === undefined || !setDefaultProvider(getDb(), id))
        return bad("模型服务不存在", 404);
      return Response.json({ ok: true });
    }),
  },

  "/api/chats": {
    GET: guarded(() => Response.json(listChats(getDb()))),
    POST: guarded(async (req: Request) => {
      const body = await readJson(req);
      const provider =
        typeof body.providerId === "number"
          ? getProvider(getDb(), body.providerId)
          : undefined;
      if (!provider) return bad("请先选择一个模型服务");
      return Response.json(
        { id: createChat(getDb(), provider) },
        { status: 201 },
      );
    }),
  },

  "/api/chats/:id": {
    GET: guarded((req: ChatRequest) => {
      const id = parseId(req.params.id);
      const chat = id === undefined ? undefined : getChat(getDb(), id);
      if (!chat) return bad("对话不存在", 404);
      return Response.json({
        chat,
        items: displayMessages(chat.kind, loadMessages(getDb(), chat.id)),
      });
    }),
    DELETE: guarded((req: ChatRequest) => {
      const id = parseId(req.params.id);
      if (id === undefined || !deleteChat(getDb(), id))
        return bad("对话不存在", 404);
      return Response.json({ ok: true });
    }),
  },

  /** Sends a message; the reply arrives as a server-sent event stream. */
  "/api/chats/:id/messages": {
    POST: guarded(async (req: Bun.BunRequest<"/api/chats/:id/messages">) => {
      const id = parseId(req.params.id);
      if (id === undefined || !getChat(getDb(), id))
        return bad("对话不存在", 404);
      const body = await readJson(req);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return bad("消息不能为空");
      if (runningChats.has(id)) return bad("上一条消息还在处理中", 409);
      return streamTurn(req, id, text);
    }),
  },

  /** The user's answer to a write the assistant wants to make. */
  "/api/chat-approvals/:callId": {
    POST: guarded(
      async (req: Bun.BunRequest<"/api/chat-approvals/:callId">) => {
        const body = await readJson(req);
        const resolve = pendingApprovals.get(req.params.callId);
        if (typeof body.approve !== "boolean") return bad("需要 approve 字段");
        if (!resolve) return bad("这次操作已经不在等待确认", 404);
        resolve(body.approve);
        return Response.json({ ok: true });
      },
    ),
  },
};
