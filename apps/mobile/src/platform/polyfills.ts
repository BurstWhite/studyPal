/**
 * Web APIs the shared code uses that Hermes / React Native lack or implement
 * only partly. Imported first, before anything from `@studypal/*`.
 *
 * Expo's runtime already provides `fetch` (with streaming, `redirect` and
 * `credentials`), `URL`, `ReadableStream` and `TextDecoderStream`. React
 * Native's `Response`, however, cannot carry a `ReadableStream` body, which
 * the chat route's in-process event stream needs.
 */
import { randomUUID } from "expo-crypto";
import { splitSetCookie } from "./cookies";

// --- AbortSignal.timeout ---------------------------------------------------
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("超时", "TimeoutError")),
      ms,
    );
    return controller.signal;
  };
}

// --- crypto.randomUUID -----------------------------------------------------
const globalCrypto = (globalThis.crypto ??= {} as Crypto);
if (typeof globalCrypto.randomUUID !== "function") {
  globalCrypto.randomUUID = randomUUID as Crypto["randomUUID"];
}

// --- Headers.prototype.getSetCookie ----------------------------------------
if (typeof Headers.prototype.getSetCookie !== "function") {
  // iOS joins repeated Set-Cookie headers; split them again.
  Headers.prototype.getSetCookie = function getSetCookie(this: Headers) {
    const joined = this.get("set-cookie");
    return joined ? splitSetCookie(joined) : [];
  };
}

// --- Response with a streaming body ----------------------------------------
type BodySource = string | Uint8Array | ArrayBuffer | ReadableStream | null;

function toStream(body: BodySource): ReadableStream<Uint8Array> | null {
  if (body === null || body === undefined) return null;
  if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>;
  const bytes =
    typeof body === "string"
      ? new TextEncoder().encode(body)
      : body instanceof Uint8Array
        ? body
        : new Uint8Array(body);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Enough of the Fetch `Response` for responses created in-process by the
 * shared route handlers: status, headers, `json()`/`text()`, and a real
 * `body` stream. Responses from the network keep Expo's own class.
 */
class StreamingResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly type = "default";
  readonly url = "";
  readonly redirected = false;
  private used = false;

  constructor(
    body?: BodySource,
    init: { status?: number; statusText?: string; headers?: HeadersInit } = {},
  ) {
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "";
    this.headers = new Headers(init.headers);
    this.body = toStream(body ?? null);
    if (typeof body === "string" && !this.headers.has("content-type")) {
      this.headers.set("content-type", "text/plain;charset=UTF-8");
    }
  }

  static json(data: unknown, init: ResponseInit = {}): StreamingResponse {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type"))
      headers.set("content-type", "application/json");
    return new StreamingResponse(JSON.stringify(data), { ...init, headers });
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  get bodyUsed(): boolean {
    return this.used;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.used) throw new TypeError("Body has already been consumed");
    this.used = true;
    if (!this.body) return new ArrayBuffer(0);
    const reader = this.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    const all = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    return all.buffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }

  clone(): never {
    throw new Error("clone() is not supported for in-process responses");
  }
}

function supportsStreamingBody(): boolean {
  try {
    const body = new Response(new ReadableStream()).body;
    return typeof body?.getReader === "function";
  } catch {
    return false;
  }
}

if (!supportsStreamingBody()) {
  globalThis.Response = StreamingResponse as unknown as typeof Response;
}

// --- Fail loudly on anything still missing ---------------------------------
for (const name of ["TextEncoder", "TextDecoder", "ReadableStream"] as const) {
  if (typeof globalThis[name] !== "function") {
    throw new Error(`studyPal needs ${name}, which this runtime lacks`);
  }
}
