/** Model providers and stored conversations. */
import type { Database } from "bun:sqlite";
import { secrets } from "bun";
import { config } from "../config";
import { AnthropicConversation, displayAnthropic } from "./anthropic";
import { displayOpenAi, OpenAiConversation } from "./openai";
import type { Conversation, DisplayItem } from "./turn";

export type ProviderKind =
  "anthropic" | "openai-compatible" | "deepseek" | "opencode" | "opencode-go";

export const PROVIDER_KINDS: ProviderKind[] = [
  "anthropic",
  "openai-compatible",
  "deepseek",
  "opencode",
  "opencode-go",
];

/**
 * Where each kind is reached when the user leaves the Base URL blank.
 * DeepSeek and OpenCode speak the OpenAI chat-completions protocol.
 */
export const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  anthropic: "",
  "openai-compatible": "",
  deepseek: "https://api.deepseek.com",
  // OpenCode serves pay-as-you-go and the Go subscription from different
  // addresses. A Go key sent to the pay-as-you-go one is charged against a
  // credit balance the subscriber does not have, and fails with HTTP 402.
  opencode: "https://opencode.ai/inference/openai/v1",
  "opencode-go": "https://opencode.ai/inference/go/openai/v1",
};

/** How studyPal identifies itself; OpenCode asks clients not to use a generic one. */
const USER_AGENT = "studyPal/0.1.0";

const isOpenCode = (kind: ProviderKind) =>
  kind === "opencode" || kind === "opencode-go";

const usesAnthropicFormat = (kind: ProviderKind) => kind === "anthropic";

export interface Provider {
  id: number;
  name: string;
  kind: ProviderKind;
  /** Empty means the kind's default endpoint. */
  baseUrl: string;
  model: string;
  isDefault: boolean;
}

export interface ProviderInput {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** Required when creating; when updating, empty keeps the stored key. */
  apiKey: string;
}

export class ProviderInputError extends Error {}

const SECRET_SERVICE = config.secretService;
const secretName = (id: number) => `provider-${id}`;

/** API keys live in the system keychain, never in the database. */
export interface KeyStore {
  get(id: number): Promise<string | null>;
  set(id: number, value: string): Promise<void>;
  delete(id: number): Promise<void>;
}

export const keychain: KeyStore = {
  get: (id) => secrets.get({ service: SECRET_SERVICE, name: secretName(id) }),
  set: (id, value) =>
    secrets.set({ service: SECRET_SERVICE, name: secretName(id), value }),
  delete: async (id) => {
    await secrets.delete({ service: SECRET_SERVICE, name: secretName(id) });
  },
};

export function parseProviderInput(
  body: unknown,
  creating: boolean,
): ProviderInput {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const field = (key: string) =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : "";

  const kind = field("kind");
  if (!PROVIDER_KINDS.includes(kind as ProviderKind)) {
    throw new ProviderInputError("请选择服务类型");
  }
  const model = field("model");
  if (!model) throw new ProviderInputError("请填写模型名称");

  const baseUrl = field("baseUrl");
  if (kind === "openai-compatible" && !baseUrl) {
    throw new ProviderInputError("OpenAI 兼容服务需要填写 Base URL");
  }
  if (baseUrl) {
    let url: URL | undefined;
    try {
      url = new URL(baseUrl);
    } catch {
      // handled below
    }
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
      throw new ProviderInputError("Base URL 必须以 http:// 或 https:// 开头");
    }
  }

  const apiKey = field("apiKey");
  if (creating && !apiKey) throw new ProviderInputError("请填写 API key");

  return {
    name: field("name") || model,
    kind: kind as ProviderKind,
    baseUrl,
    model,
    apiKey,
  };
}

interface ProviderRow {
  id: number;
  name: string;
  kind: ProviderKind;
  base_url: string;
  model: string;
  is_default: number;
}

const toProvider = (row: ProviderRow): Provider => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  baseUrl: row.base_url,
  model: row.model,
  isDefault: row.is_default === 1,
});

export function listProviders(db: Database): Provider[] {
  const rows = db
    .query("SELECT * FROM providers ORDER BY id")
    .all() as ProviderRow[];
  return rows.map(toProvider);
}

export function getProvider(db: Database, id: number): Provider | undefined {
  const row = db
    .query("SELECT * FROM providers WHERE id = ?")
    .get(id) as ProviderRow | null;
  return row ? toProvider(row) : undefined;
}

export async function createProvider(
  db: Database,
  input: ProviderInput,
  keys: KeyStore = keychain,
): Promise<number> {
  const first =
    (db.query("SELECT count(*) AS n FROM providers").get() as { n: number })
      .n === 0;
  const result = db
    .query(
      "INSERT INTO providers (name, kind, base_url, model, is_default) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.name, input.kind, input.baseUrl, input.model, first ? 1 : 0);
  const id = Number(result.lastInsertRowid);
  try {
    await keys.set(id, input.apiKey);
  } catch (error) {
    // A provider without its key is useless; do not leave it behind.
    db.query("DELETE FROM providers WHERE id = ?").run(id);
    throw error;
  }
  return id;
}

export async function updateProvider(
  db: Database,
  id: number,
  input: ProviderInput,
  keys: KeyStore = keychain,
): Promise<boolean> {
  const result = db
    .query(
      "UPDATE providers SET name = ?, kind = ?, base_url = ?, model = ? WHERE id = ?",
    )
    .run(input.name, input.kind, input.baseUrl, input.model, id);
  if (result.changes === 0) return false;
  if (input.apiKey) await keys.set(id, input.apiKey);
  return true;
}

export async function deleteProvider(
  db: Database,
  id: number,
  keys: KeyStore = keychain,
): Promise<boolean> {
  const row = db
    .query("SELECT is_default FROM providers WHERE id = ?")
    .get(id) as {
    is_default: number;
  } | null;
  if (!row) return false;
  db.query("DELETE FROM providers WHERE id = ?").run(id);
  // Keep exactly one default while any provider remains.
  if (row.is_default === 1) {
    db.exec(
      "UPDATE providers SET is_default = 1 WHERE id = (SELECT min(id) FROM providers)",
    );
  }
  await keys.delete(id);
  return true;
}

export function setDefaultProvider(db: Database, id: number): boolean {
  if (!getProvider(db, id)) return false;
  db.transaction(() => {
    db.exec("UPDATE providers SET is_default = 0");
    db.query("UPDATE providers SET is_default = 1 WHERE id = ?").run(id);
  })();
  return true;
}

export interface ChatSummary {
  id: number;
  title: string;
  /** Null when the provider it used has been removed. */
  providerId: number | null;
  kind: ProviderKind;
  updatedAt: string;
}

interface ChatRow {
  id: number;
  title: string;
  provider_id: number | null;
  kind: ProviderKind;
  updated_at: string;
}

const toChat = (row: ChatRow): ChatSummary => ({
  id: row.id,
  title: row.title,
  providerId: row.provider_id,
  kind: row.kind,
  updatedAt: row.updated_at,
});

export function listChats(db: Database): ChatSummary[] {
  const rows = db
    .query(
      "SELECT id, title, provider_id, kind, updated_at FROM chats ORDER BY updated_at DESC, id DESC",
    )
    .all() as ChatRow[];
  return rows.map(toChat);
}

export function getChat(db: Database, id: number): ChatSummary | undefined {
  const row = db
    .query(
      "SELECT id, title, provider_id, kind, updated_at FROM chats WHERE id = ?",
    )
    .get(id) as ChatRow | null;
  return row ? toChat(row) : undefined;
}

/**
 * A chat keeps the wire format of the provider it started with, because its
 * stored messages are replayed to the model exactly as they were exchanged.
 */
export function createChat(db: Database, provider: Provider): number {
  const result = db
    .query(
      "INSERT INTO chats (provider_id, kind, session_key) VALUES (?, ?, ?)",
    )
    .run(provider.id, provider.kind, crypto.randomUUID());
  return Number(result.lastInsertRowid);
}

export function deleteChat(db: Database, id: number): boolean {
  return db.query("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
}

export function loadMessages(db: Database, chatId: number): unknown[] {
  const rows = db
    .query("SELECT content FROM messages WHERE chat_id = ? ORDER BY id")
    .all(chatId) as { content: string }[];
  return rows.map((row) => JSON.parse(row.content) as unknown);
}

/** Stores the messages a finished turn added, and names an untitled chat. */
export function appendMessages(
  db: Database,
  chatId: number,
  messages: unknown[],
  titleIfEmpty: string,
): void {
  const insert = db.query(
    "INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    for (const message of messages) {
      const role = (message as { role?: string }).role ?? "unknown";
      insert.run(chatId, role, JSON.stringify(message));
    }
    db.query(
      `UPDATE chats SET updated_at = datetime('now'),
         title = CASE WHEN title = '' THEN ? ELSE title END
       WHERE id = ?`,
    ).run(titleIfEmpty, chatId);
  })();
}

export function displayMessages(
  kind: ProviderKind,
  messages: unknown[],
): DisplayItem[] {
  return usesAnthropicFormat(kind)
    ? displayAnthropic(messages)
    : displayOpenAi(messages);
}

/** The chat's session identifier, created on first use for older chats. */
export function sessionKey(db: Database, chatId: number): string {
  const row = db
    .query("SELECT session_key FROM chats WHERE id = ?")
    .get(chatId) as {
    session_key: string | null;
  } | null;
  if (row?.session_key) return row.session_key;
  const key = crypto.randomUUID();
  db.query("UPDATE chats SET session_key = ? WHERE id = ?").run(key, chatId);
  return key;
}

/** Why a chat cannot continue, as a message for the user. */
export class ChatUnavailable extends Error {}

/** Opens a chat's conversation against its provider, with its history loaded. */
export async function openConversation(
  db: Database,
  chat: ChatSummary,
  keys: KeyStore = keychain,
  fetchImpl?: typeof fetch,
): Promise<Conversation> {
  const provider =
    chat.providerId === null ? undefined : getProvider(db, chat.providerId);
  if (!provider)
    throw new ChatUnavailable("这段对话使用的模型服务已被删除，请新建对话。");
  if (provider.kind !== chat.kind) {
    throw new ChatUnavailable(
      "这段对话使用的模型服务已改成另一种类型，请新建对话。",
    );
  }
  const apiKey = await keys.get(provider.id);
  if (!apiKey)
    throw new ChatUnavailable(
      "找不到这个模型服务的 API key，请在设置里重新填写。",
    );

  const settings = {
    apiKey,
    baseUrl: provider.baseUrl || DEFAULT_BASE_URL[provider.kind],
    model: provider.model,
    fetch: fetchImpl,
  };
  const history = loadMessages(db, chat.id);
  if (usesAnthropicFormat(provider.kind))
    return new AnthropicConversation(settings, history);
  return new OpenAiConversation(
    {
      ...settings,
      // OpenCode routes and caches by a stable per-conversation session id
      // (the Go plan requires it), written like `ses_…`.
      ...(isOpenCode(provider.kind)
        ? {
            headers: {
              "User-Agent": USER_AGENT,
              "x-opencode-session": `ses_${sessionKey(db, chat.id).replaceAll("-", "")}`,
            },
          }
        : {}),
    },
    history,
  );
}
