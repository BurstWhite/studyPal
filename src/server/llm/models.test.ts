import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db";
import { fetchModels, testConnection } from "./models";
import {
  appendMessages,
  createChat,
  createProvider,
  getChat,
  getProvider,
  openConversation,
  parseProviderInput,
  setChatModel,
  type KeyStore,
} from "./store";

const keys: KeyStore = {
  get: async () => "sk-test",
  set: async () => {},
  delete: async () => {},
};

/** A fetch that records each request and answers with `respond`. */
function recording(respond: (url: string) => Response) {
  const requests: { url: string; headers: Headers; body: any }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    const raw = input instanceof Request ? await input.text() : init?.body;
    requests.push({
      url,
      headers,
      body: typeof raw === "string" && raw ? JSON.parse(raw) : undefined,
    });
    return respond(url);
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe("model lists", () => {
  test("OpenAI-style lists drop models that cannot chat, sorted", async () => {
    const api = recording(() =>
      Response.json({
        data: [
          { id: "gpt-6" },
          { id: "text-embedding-3-large" },
          { id: "deepseek-v4-pro" },
          { id: "tts-2" },
        ],
      }),
    );
    const models = await fetchModels({
      kind: "deepseek",
      baseUrl: "",
      apiKey: "sk-test",
      fetch: api.fetchImpl,
    });
    expect(models).toEqual(["deepseek-v4-pro", "gpt-6"]);
    expect(api.requests[0]!.url).toBe("https://api.deepseek.com/models");
    expect(api.requests[0]!.headers.get("authorization")).toBe(
      "Bearer sk-test",
    );
  });

  test("OpenCode lists are asked for with its client headers", async () => {
    const api = recording(() => Response.json({ data: [{ id: "kimi-k3" }] }));
    await fetchModels({
      kind: "opencode-go",
      baseUrl: "",
      apiKey: "sk-test",
      fetch: api.fetchImpl,
    });
    expect(api.requests[0]!.url).toBe(
      "https://opencode.ai/inference/go/openai/v1/models",
    );
    expect(api.requests[0]!.headers.get("user-agent")).toStartWith("studyPal/");
    expect(api.requests[0]!.headers.get("x-opencode-session")).toStartWith(
      "ses_",
    );
  });

  test("Anthropic lists keep the service's order", async () => {
    const api = recording(() =>
      Response.json({
        data: [
          { id: "claude-opus-5-5", type: "model" },
          { id: "claude-haiku-5-5", type: "model" },
        ],
        has_more: false,
        first_id: "claude-opus-5-5",
        last_id: "claude-haiku-5-5",
      }),
    );
    const models = await fetchModels({
      kind: "anthropic",
      baseUrl: "",
      apiKey: "sk-test",
      fetch: api.fetchImpl,
    });
    expect(models).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    expect(api.requests[0]!.url).toStartWith(
      "https://api.anthropic.com/v1/models",
    );
  });

  test("a rejected key says so", async () => {
    const api = recording(
      () => new Response('{"error":"bad key"}', { status: 401 }),
    );
    expect(
      fetchModels({
        kind: "openai-compatible",
        baseUrl: "https://example.com/v1/",
        apiKey: "sk-test",
        fetch: api.fetchImpl,
      }),
    ).rejects.toThrow("API key 无效");
  });
});

describe("connection test", () => {
  test("reports the reply to a short message", async () => {
    const api = recording(() =>
      Response.json({ choices: [{ message: { content: " OK\n" } }] }),
    );
    const result = await testConnection(
      {
        kind: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        fetch: api.fetchImpl,
      },
      "some-model",
    );
    expect(result).toMatchObject({ ok: true, reply: "OK" });
    expect(api.requests[0]!.url).toBe(
      "https://example.com/v1/chat/completions",
    );
    expect(api.requests[0]!.body.model).toBe("some-model");
    expect(api.requests[0]!.body.messages).toHaveLength(1);
  });

  test("reports why it failed", async () => {
    const api = recording(() => new Response("{}", { status: 404 }));
    expect(
      await testConnection(
        { kind: "deepseek", baseUrl: "", apiKey: "sk", fetch: api.fetchImpl },
        "nope",
      ),
    ).toEqual({
      ok: false,
      error: "找不到这个模型或接口地址，请检查模型名称和 Base URL。",
    });
  });
});

describe("a chat's model", () => {
  const db = () => openDatabase(":memory:");
  const add = async (d: ReturnType<typeof db>, input: object) =>
    getProvider(
      d,
      await createProvider(d, parseProviderInput(input, true), keys),
    )!;

  test("overrides the provider's model and can change mid-chat", async () => {
    const d = db();
    const provider = await add(d, {
      kind: "deepseek",
      model: "deepseek-flash",
      apiKey: "sk",
    });
    const chatId = createChat(d, provider, "deepseek-v4-pro");
    expect(getChat(d, chatId)!.model).toBe("deepseek-v4-pro");

    const api = recording(
      () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ),
    );
    const conversation = await openConversation(
      d,
      getChat(d, chatId)!,
      keys,
      api.fetchImpl,
    );
    conversation.addUser("hi", new Date());
    await conversation.step([], () => {}, new AbortController().signal);
    expect(api.requests[0]!.body.model).toBe("deepseek-v4-pro");
    appendMessages(d, chatId, conversation.messages(), "hi");

    // Same wire format: the history can come along.
    const other = await add(d, {
      kind: "opencode",
      model: "kimi-k3",
      apiKey: "sk",
    });
    expect(setChatModel(d, chatId, other, "glm-5.3")).toBe("ok");
    expect(getChat(d, chatId)).toMatchObject({
      providerId: other.id,
      kind: "opencode",
      model: "glm-5.3",
    });

    // Another wire format cannot read it.
    const claude = await add(d, {
      kind: "anthropic",
      model: "claude-opus-5-5",
      apiKey: "sk",
    });
    expect(setChatModel(d, chatId, claude, null)).toBe("incompatible");
    expect(setChatModel(d, 999, claude, null)).toBe("missing");
  });

  test("an empty chat can move to any wire format", async () => {
    const d = db();
    const provider = await add(d, {
      kind: "deepseek",
      model: "deepseek-flash",
      apiKey: "sk",
    });
    const claude = await add(d, {
      kind: "anthropic",
      model: "claude-opus-5-5",
      apiKey: "sk",
    });
    const chatId = createChat(d, provider);
    expect(getChat(d, chatId)!.model).toBeNull();
    expect(setChatModel(d, chatId, claude, "claude-sonnet-5-5")).toBe("ok");
    expect(getChat(d, chatId)).toMatchObject({
      kind: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });
});
