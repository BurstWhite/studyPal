/**
 * Talking to a provider outside a conversation: which models it offers, and
 * whether a short message gets through at all.
 */
import type { Db } from "../platform";
import { anthropicClient, describeError } from "./anthropic";
import { describeStatus } from "./openai";
import {
  DEFAULT_BASE_URL,
  isOpenCode,
  keychain,
  listProviders,
  USER_AGENT,
  type KeyStore,
  type Provider,
  type ProviderKind,
} from "./store";

/** What is needed to reach a provider, whether saved or still being typed. */
export interface Connection {
  kind: ProviderKind;
  /** Empty means the kind's default endpoint. */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

const REQUEST_TIMEOUT_MS = 15_000;

const resolvedBase = (connection: Connection) =>
  (connection.baseUrl || DEFAULT_BASE_URL[connection.kind]).replace(/\/+$/, "");

function openAiHeaders(connection: Connection): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${connection.apiKey}`,
    // OpenCode wants a named client, and the Go plan a session on every call.
    ...(isOpenCode(connection.kind)
      ? {
          "User-Agent": USER_AGENT,
          "x-opencode-session": `ses_${crypto.randomUUID().replaceAll("-", "")}`,
        }
      : {}),
  };
}

/** Ids of things an OpenAI-style `/models` list carries that cannot chat. */
const NOT_CHAT =
  /embed|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|sora/i;

/**
 * The model ids a provider offers. Anthropic lists newest first, which is kept;
 * other lists come in no useful order and are sorted.
 */
export async function fetchModels(connection: Connection): Promise<string[]> {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (connection.kind === "anthropic") {
    const client = anthropicClient({
      apiKey: connection.apiKey,
      baseUrl: connection.baseUrl,
      fetch: connection.fetch,
    });
    const ids: string[] = [];
    try {
      for await (const model of client.models.list({ limit: 100 }, { signal }))
        ids.push(model.id);
    } catch (error) {
      throw new Error(describeError(error));
    }
    return ids;
  }

  let response: Response;
  try {
    response = await (connection.fetch ?? fetch)(
      `${resolvedBase(connection)}/models`,
      { headers: openAiHeaders(connection), signal },
    );
  } catch {
    throw new Error("无法连接到模型服务，请检查网络和 Base URL。");
  }
  const body = await response.text().catch(() => "");
  if (!response.ok) throw new Error(describeStatus(response.status, body));
  let parsed: { data?: { id?: unknown }[] };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new Error("模型服务返回的模型列表无法识别。");
  }
  return (parsed.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && !NOT_CHAT.test(id))
    .sort((a, b) => a.localeCompare(b));
}

export type TestResult =
  | { ok: true; model: string; reply: string; latencyMs: number }
  | { ok: false; error: string };

/**
 * Models a new chat starts on when nothing says otherwise, most preferred
 * first. A kind without an entry takes the first model its service lists
 * (Anthropic lists its newest first).
 */
const PREFERRED_MODELS: Partial<Record<ProviderKind, string[]>> = {
  deepseek: ["deepseek-flash", "deepseek-chat"],
};

/** The model to use from a service's list, or undefined if it is empty. */
export function pickModel(
  kind: ProviderKind,
  models: string[],
): string | undefined {
  return (
    PREFERRED_MODELS[kind]?.find((model) => models.includes(model)) ?? models[0]
  );
}

const TEST_PROMPT = "Reply with the single word: OK";

/** Sends one short message and reports the reply, or why there was none. */
export async function testConnection(
  connection: Connection,
  /** Omitted: one is picked from the service's model list. */
  chosen?: string,
): Promise<TestResult> {
  let model = chosen;
  if (!model) {
    try {
      model = pickModel(connection.kind, await fetchModels(connection));
    } catch (error) {
      return {
        ok: false,
        error: `无法获取模型列表：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!model) return { ok: false, error: "这个服务没有列出任何可用的模型。" };
  }

  const started = performance.now();
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2);
  const done = (reply: string): TestResult => ({
    ok: true,
    model: model,
    reply: reply.trim().slice(0, 200),
    latencyMs: Math.round(performance.now() - started),
  });

  if (connection.kind === "anthropic") {
    try {
      const message = await anthropicClient({
        apiKey: connection.apiKey,
        baseUrl: connection.baseUrl,
        fetch: connection.fetch,
      }).messages.create(
        {
          model,
          max_tokens: 32,
          messages: [{ role: "user", content: TEST_PROMPT }],
        },
        { signal },
      );
      return done(
        message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join(""),
      );
    } catch (error) {
      if (signal.aborted) return { ok: false, error: "等待回复超时了。" };
      return { ok: false, error: describeError(error) };
    }
  }

  let response: Response;
  try {
    response = await (connection.fetch ?? fetch)(
      `${resolvedBase(connection)}/chat/completions`,
      {
        method: "POST",
        headers: openAiHeaders(connection),
        signal,
        // No token limit: reasoning models spend their budget thinking first,
        // and some services reject the field outright.
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: TEST_PROMPT }],
        }),
      },
    );
  } catch {
    if (signal.aborted) return { ok: false, error: "等待回复超时了。" };
    return { ok: false, error: "无法连接到模型服务，请检查网络和 Base URL。" };
  }
  const body = await response.text().catch(() => "");
  if (!response.ok)
    return { ok: false, error: describeStatus(response.status, body) };
  try {
    const parsed = JSON.parse(body) as {
      choices?: { message?: { content?: string | null } }[];
    };
    return done(parsed.choices?.[0]?.message?.content ?? "");
  } catch {
    return { ok: false, error: "模型服务的回复无法识别。" };
  }
}

/** How long a fetched model list is trusted before it is fetched again. */
const MODELS_TTL_MS = 30 * 60_000;

export interface ModelList {
  providerId: number;
  models: string[];
  /** Why the list could not be fetched; `models` is then the last good one. */
  error?: string;
}

interface CacheEntry {
  models: string[];
  error?: string;
  fetchedAt: number;
  pending?: Promise<void>;
}

const cache = new Map<number, CacheEntry>();

/** Forgets a provider's list, after its address or key changed. */
export function forgetModels(providerId: number): void {
  cache.delete(providerId);
}

function refresh(
  provider: Provider,
  keys: KeyStore,
  entry: CacheEntry,
): Promise<void> {
  entry.pending ??= (async () => {
    try {
      const apiKey = await keys.get(provider.id);
      if (!apiKey) throw new Error("找不到这个模型服务的 API key。");
      entry.models = await fetchModels({
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        apiKey,
      });
      entry.error = undefined;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
    } finally {
      entry.fetchedAt = Date.now();
      entry.pending = undefined;
    }
  })();
  return entry.pending;
}

/**
 * Every provider's models. A list fetched before is returned at once (and
 * refreshed behind the scenes once stale); one never fetched is waited for.
 */
export async function modelLists(
  db: Db,
  keys: KeyStore = keychain,
): Promise<ModelList[]> {
  const providers = listProviders(db);
  await Promise.all(
    providers.map(async (provider) => {
      let entry = cache.get(provider.id);
      if (!entry) {
        entry = { models: [], fetchedAt: 0 };
        cache.set(provider.id, entry);
        await refresh(provider, keys, entry);
      } else if (entry.pending && entry.fetchedAt === 0) {
        await entry.pending;
      } else if (Date.now() - entry.fetchedAt > MODELS_TTL_MS) {
        void refresh(provider, keys, entry);
      }
    }),
  );
  return providers.map((provider) => {
    const entry = cache.get(provider.id)!;
    return {
      providerId: provider.id,
      models: entry.models,
      ...(entry.error ? { error: entry.error } : {}),
    };
  });
}

/**
 * The model a new chat with this provider starts on: the one set on the
 * provider, else one picked from the list the service gave.
 */
export async function defaultModel(
  db: Db,
  provider: Provider,
  keys: KeyStore = keychain,
): Promise<string> {
  if (provider.model) return provider.model;
  const list = (await modelLists(db, keys)).find(
    (entry) => entry.providerId === provider.id,
  );
  const model = list && pickModel(provider.kind, list.models);
  if (!model)
    throw new Error(
      list?.error
        ? `无法获取「${provider.name}」的模型列表：${list.error}`
        : `「${provider.name}」没有列出任何可用的模型。`,
    );
  return model;
}

/** Fetches every provider's list in the background, e.g. at startup. */
export function warmModelLists(db: Db, keys: KeyStore = keychain): void {
  modelLists(db, keys).catch((error) =>
    console.error("fetching model lists failed:", error),
  );
}
