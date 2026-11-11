/**
 * Conversations with any service that speaks the OpenAI chat-completions
 * protocol (`POST {base}/chat/completions` with streaming and function tools).
 */
import type { ToolDefinition } from "./tools";
import {
  SYSTEM_PROMPT,
  timeContext,
  TurnError,
  type Conversation,
  type DisplayItem,
  type Emit,
  type ToolCall,
  type ToolResult,
} from "./turn";

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type WireMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      /** The model's reasoning, kept only for providers that return it. */
      reasoning_content?: string;
      tool_calls?: WireToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenAiSettings {
  apiKey: string;
  /** For example `https://api.example.com/v1`. */
  baseUrl: string;
  model: string;
  /** Extra request headers a provider needs. */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

/** Separates the time context from what the user typed. */
const CONTEXT_SEPARATOR = "\n\n---\n\n";
/** Tool failures are flagged in the text; the protocol has no error field. */
const ERROR_PREFIX = "ERROR: ";

function describeStatus(status: number, body: string): string {
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
    };
    const message =
      typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (message) detail = message;
  } catch {
    // Not JSON; keep the raw text.
  }
  if (status === 401) return "API key 无效，请在设置里检查。";
  if (status === 403) return `这个 API key 没有权限：${detail}`;
  if (status === 404)
    return "找不到这个模型或接口地址，请检查模型名称和 Base URL。";
  if (status === 429) return "请求过于频繁或额度已用完，请稍后再试。";
  return `模型服务返回 HTTP ${status}：${detail}`;
}

/** Yields the JSON payload of each `data:` line of a server-sent event stream. */
async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith("data:")) yield rest.slice(5).trim();
}

export class OpenAiConversation implements Conversation {
  private readonly history: WireMessage[];

  constructor(
    private readonly settings: OpenAiSettings,
    history: unknown[] = [],
  ) {
    this.history = history as WireMessage[];
  }

  addUser(text: string, now: Date): void {
    this.history.push({
      role: "user",
      content: `${timeContext(now)}${CONTEXT_SEPARATOR}${text}`,
    });
  }

  addToolResults(results: ToolResult[]): void {
    for (const result of results) {
      this.history.push({
        role: "tool",
        tool_call_id: result.id,
        content: result.isError
          ? `${ERROR_PREFIX}${result.content}`
          : result.content,
      });
    }
  }

  messages(): unknown[] {
    return this.history;
  }

  async step(
    tools: ToolDefinition[],
    emit: Emit,
    signal: AbortSignal,
  ): Promise<ToolCall[]> {
    const url = `${this.settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let response: Response;
    try {
      response = await (this.settings.fetch ?? fetch)(url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
          ...this.settings.headers,
        },
        body: JSON.stringify({
          model: this.settings.model,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...this.history,
          ],
          tools: tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }),
      });
    } catch (error) {
      if (signal.aborted) throw new TurnError("已取消");
      throw new TurnError("无法连接到模型服务，请检查网络和 Base URL。");
    }
    if (!response.ok || !response.body) {
      throw new TurnError(
        describeStatus(response.status, await response.text().catch(() => "")),
      );
    }

    let text = "";
    let reasoning = "";
    let finishReason: string | undefined;
    const partial: { id: string; name: string; arguments: string }[] = [];
    try {
      for await (const data of sseData(response.body)) {
        if (data === "[DONE]") break;
        let chunk: {
          error?: { message?: string };
          choices?: {
            finish_reason?: string | null;
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue; // keep-alive comments and the like
        }
        if (chunk.error)
          throw new TurnError(
            `模型服务出错：${chunk.error.message ?? "未知错误"}`,
          );

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (choice.delta?.reasoning_content) {
          if (!reasoning) emit({ type: "thinking" });
          reasoning += choice.delta.reasoning_content;
        }
        if (choice.delta?.content) {
          text += choice.delta.content;
          emit({ type: "text", delta: choice.delta.content });
        }
        // Tool calls arrive in fragments keyed by index.
        for (const fragment of choice.delta?.tool_calls ?? []) {
          const slot = (partial[fragment.index ?? 0] ??= {
            id: "",
            name: "",
            arguments: "",
          });
          if (fragment.id) slot.id = fragment.id;
          if (fragment.function?.name) slot.name += fragment.function.name;
          if (fragment.function?.arguments)
            slot.arguments += fragment.function.arguments;
        }
      }
    } catch (error) {
      if (error instanceof TurnError) throw error;
      if (signal.aborted) throw new TurnError("已取消");
      throw new TurnError("与模型服务的连接中断了，请重试。");
    }

    const wireCalls: WireToolCall[] = partial
      .filter((slot) => slot !== undefined && slot.name)
      .map((slot, index) => ({
        id: slot.id || `call_${Date.now()}_${index}`,
        type: "function",
        function: { name: slot.name, arguments: slot.arguments || "{}" },
      }));

    if (finishReason === "length" && wireCalls.length > 0) {
      throw new TurnError("模型的回复超出了长度上限，工具调用不完整，请重试。");
    }
    if (finishReason === "content_filter") {
      throw new TurnError(
        "模型服务的内容过滤拦截了这次回复，可以换个说法再试。",
      );
    }
    if (!text && wireCalls.length === 0)
      throw new TurnError("模型没有返回任何内容。");

    this.history.push({
      role: "assistant",
      content: text || null,
      // Providers with a thinking mode (DeepSeek, for one) reject later
      // requests unless the reasoning they produced is sent back unchanged.
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(wireCalls.length > 0 ? { tool_calls: wireCalls } : {}),
    });

    return wireCalls.map((call) => {
      try {
        return {
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments),
        };
      } catch {
        return {
          id: call.id,
          name: call.function.name,
          input: null,
          invalid: call.function.arguments,
        };
      }
    });
  }

  display(): DisplayItem[] {
    return displayOpenAi(this.history);
  }
}

/** Turns stored chat-completions messages into rows for the chat view. */
export function displayOpenAi(history: unknown[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  const tools = new Map<string, Extract<DisplayItem, { type: "tool" }>>();

  for (const message of history as WireMessage[]) {
    if (message.role === "user") {
      const cut = message.content.indexOf(CONTEXT_SEPARATOR);
      items.push({
        type: "user",
        text:
          cut >= 0
            ? message.content.slice(cut + CONTEXT_SEPARATOR.length)
            : message.content,
      });
    } else if (message.role === "assistant") {
      if (message.content?.trim())
        items.push({ type: "assistant", text: message.content });
      for (const call of message.tool_calls ?? []) {
        let input: unknown = call.function.arguments;
        try {
          input = JSON.parse(call.function.arguments);
        } catch {
          // Show the raw text when it is not valid JSON.
        }
        const item = {
          type: "tool" as const,
          id: call.id,
          name: call.function.name,
          input,
        };
        tools.set(call.id, item);
        items.push(item);
      }
    } else {
      const item = tools.get(message.tool_call_id);
      if (item) {
        const failed = message.content.startsWith(ERROR_PREFIX);
        item.result = {
          ok: !failed,
          content: failed
            ? message.content.slice(ERROR_PREFIX.length)
            : message.content,
        };
      }
    }
  }
  return items;
}
