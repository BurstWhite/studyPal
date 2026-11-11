/** Conversations with Claude through the official Anthropic SDK. */
import Anthropic from "@anthropic-ai/sdk";
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

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

const OFFICIAL_HOST = "api.anthropic.com";
const OFFICIAL_BASE_URL = `https://${OFFICIAL_HOST}`;
const MAX_TOKENS = 64_000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Models whose safety classifiers can decline a request and that support
 * re-running it on another model inside the same call.
 */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

/** Marks the context block so it can be hidden when showing the message. */
const CONTEXT_PREFIX = "当前时间：";

export interface AnthropicSettings {
  apiKey: string;
  /** Empty for the official endpoint. */
  baseUrl: string;
  model: string;
  /** Overrides the network layer in tests. */
  fetch?: typeof fetch;
}

function isOfficial(baseUrl: string): boolean {
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === OFFICIAL_HOST;
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  // Most specific first: each needs a different response from the user.
  if (error instanceof Anthropic.AuthenticationError)
    return "API key 无效，请在设置里检查。";
  if (error instanceof Anthropic.PermissionDeniedError)
    return "这个 API key 没有权限使用该模型。";
  if (error instanceof Anthropic.NotFoundError)
    return "找不到这个模型或接口地址，请检查模型名称和 Base URL。";
  if (error instanceof Anthropic.RateLimitError)
    return "请求过于频繁或额度已用完，请稍后再试。";
  if (error instanceof Anthropic.BadRequestError)
    return `请求被拒绝：${error.message}`;
  if (error instanceof Anthropic.APIConnectionError)
    return "无法连接到模型服务，请检查网络和 Base URL。";
  if (error instanceof Anthropic.APIError)
    return `模型服务出错（HTTP ${error.status ?? "?"}）：${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export class AnthropicConversation implements Conversation {
  private readonly client: Anthropic;
  private readonly history: MessageParam[];
  private readonly official: boolean;

  constructor(
    private readonly settings: AnthropicSettings,
    history: unknown[] = [],
  ) {
    this.history = history as MessageParam[];
    this.official = isOfficial(settings.baseUrl);
    // Every credential and address is given explicitly: the SDK would
    // otherwise pick up ANTHROPIC_* variables from the environment the app
    // happens to be launched in, instead of what the user configured.
    this.client = new Anthropic({
      apiKey: settings.apiKey,
      authToken: null,
      baseURL: settings.baseUrl || OFFICIAL_BASE_URL,
      ...(settings.fetch ? { fetch: settings.fetch } : {}),
    });
  }

  addUser(text: string, now: Date): void {
    this.history.push({
      role: "user",
      content: [
        { type: "text", text: timeContext(now) },
        { type: "text", text },
      ],
    });
  }

  addToolResults(results: ToolResult[]): void {
    this.history.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id,
        content: result.content,
        is_error: result.isError,
      })),
    });
  }

  messages(): unknown[] {
    return this.history;
  }

  async step(
    tools: ToolDefinition[],
    emit: Emit,
    signal: AbortSignal,
  ): Promise<ToolCall[]> {
    const useFallback =
      this.official && FALLBACK_MODELS.has(this.settings.model);

    let message: Anthropic.Beta.BetaMessage | undefined;
    // A tool input the SDK cannot parse at all rejects the stream; re-issue
    // the request for that case only, a limited number of times.
    for (let attempt = 0; message === undefined; attempt++) {
      try {
        const stream = this.client.beta.messages.stream(
          {
            model: this.settings.model,
            max_tokens: MAX_TOKENS,
            // The system prompt never changes, so it stays a cacheable prefix.
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema:
                tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
              // Proxies and compatible gateways may not accept this field.
              ...(this.official ? { eager_input_streaming: true } : {}),
            })),
            messages: this.history,
            // If the model's safety classifiers decline, the API retries the
            // request on another model within the same call.
            ...(useFallback
              ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
              : {}),
          },
          { signal },
        );

        for await (const event of stream) {
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "thinking"
          ) {
            emit({ type: "thinking" });
          } else if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            emit({ type: "text", delta: event.delta.text });
          }
        }
        message = await stream.finalMessage();
      } catch (error) {
        if (signal.aborted) throw new TurnError("已取消");
        if (error instanceof Anthropic.APIError || attempt >= 2) {
          throw new TurnError(describeError(error));
        }
      }
    }

    if (message.stop_reason === "refusal") {
      throw new TurnError("模型出于安全策略拒绝了这次请求，可以换个说法再试。");
    }
    const toolUses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use",
    );
    // A tool input cut off at the token limit can still look like valid JSON.
    if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
      throw new TurnError("模型的回复超出了长度上限，工具调用不完整，请重试。");
    }
    if (message.content.length === 0)
      throw new TurnError("模型没有返回任何内容。");

    // Keep the whole response, thinking blocks included, exactly as returned.
    this.history.push({
      role: "assistant",
      content: message.content as Anthropic.Beta.BetaContentBlockParam[],
    });
    return toolUses.map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    }));
  }

  display(): DisplayItem[] {
    return displayAnthropic(this.history);
  }
}

function resultText(
  content: Anthropic.Beta.BetaToolResultBlockParam["content"],
): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/** Turns stored Anthropic messages into rows for the chat view. */
export function displayAnthropic(history: unknown[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  const tools = new Map<string, Extract<DisplayItem, { type: "tool" }>>();

  for (const message of history as MessageParam[]) {
    const blocks: (Anthropic.Beta.BetaContentBlockParam | ContentBlock)[] =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : (message.content ?? []);

    let text = "";
    const flush = () => {
      if (text.trim())
        items.push({
          type: message.role === "user" ? "user" : "assistant",
          text,
        });
      text = "";
    };
    for (const block of blocks) {
      if (block.type === "text") {
        if (message.role === "user" && block.text.startsWith(CONTEXT_PREFIX))
          continue;
        text += block.text;
      } else if (block.type === "tool_use") {
        flush();
        const item = {
          type: "tool" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
        tools.set(block.id, item);
        items.push(item);
      } else if (block.type === "tool_result") {
        const item = tools.get(block.tool_use_id);
        if (item)
          item.result = {
            ok: block.is_error !== true,
            content: resultText(block.content),
          };
      }
    }
    flush();
  }
  return items;
}
