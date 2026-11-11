/**
 * A small cookie-aware HTTP client for the ZJU sites. Their single sign-on
 * hands sessions over through chains of redirects across subdomains, so each
 * hop is requested by hand and cookies are tracked per domain and path.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HOPS = 15;

interface Cookie {
  name: string;
  value: string;
  /** Lower-case host, without a leading dot. */
  domain: string;
  /** True when the cookie had no Domain attribute and so binds to one host. */
  hostOnly: boolean;
  path: string;
}

export class CookieJar {
  private cookies: Cookie[] = [];

  /** Records the Set-Cookie headers of a response received from `url`. */
  store(setCookies: string[], url: URL): void {
    for (const header of setCookies) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair!.indexOf("=");
      if (separator <= 0) continue;
      const name = pair!.slice(0, separator).trim();
      const value = pair!.slice(separator + 1).trim();

      let domain = url.hostname.toLowerCase();
      let hostOnly = true;
      let path = "/";
      let expired = false;
      for (const attribute of attributes) {
        const [rawKey, ...rest] = attribute.split("=");
        const key = rawKey!.trim().toLowerCase();
        const attributeValue = rest.join("=").trim();
        if (key === "domain" && attributeValue) {
          domain = attributeValue.replace(/^\./, "").toLowerCase();
          hostOnly = false;
        } else if (key === "path" && attributeValue.startsWith("/")) {
          path = attributeValue;
        } else if (key === "max-age") {
          if (Number(attributeValue) <= 0) expired = true;
        } else if (key === "expires") {
          const time = Date.parse(attributeValue);
          if (!Number.isNaN(time) && time <= Date.now()) expired = true;
        }
      }

      this.cookies = this.cookies.filter(
        (cookie) =>
          !(
            cookie.name === name &&
            cookie.domain === domain &&
            cookie.path === path
          ),
      );
      if (!expired && value !== "") {
        this.cookies.push({ name, value, domain, hostOnly, path });
      }
    }
  }

  private matching(url: URL): Cookie[] {
    const host = url.hostname.toLowerCase();
    return this.cookies.filter((cookie) => {
      const domainOk = cookie.hostOnly
        ? host === cookie.domain
        : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
      const pathOk =
        url.pathname === cookie.path ||
        url.pathname.startsWith(
          cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`,
        );
      return domainOk && pathOk;
    });
  }

  /** The Cookie request header for `url`, or undefined when none apply. */
  header(url: URL): string | undefined {
    const cookies = this.matching(url);
    if (cookies.length === 0) return undefined;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  get(name: string, url: string): string | undefined {
    return this.matching(new URL(url)).find((cookie) => cookie.name === name)
      ?.value;
  }
}

export interface HopResult {
  response: Response;
  body: string;
  /** The URL that produced this response. */
  url: URL;
}

/** Finds the target of an HTML `<meta http-equiv="refresh">`, if any. */
export function metaRefreshTarget(body: string, base: URL): URL | undefined {
  for (const [tag] of body.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag)) continue;
    // Decode entities first: the `;` of `&amp;` would otherwise end the URL.
    const target = /url\s*=\s*["']?([^"' >;]+)/i.exec(
      tag.replaceAll("&amp;", "&"),
    )?.[1];
    if (!target) continue;
    const url = new URL(target, base);
    if (url.protocol === "https:" && isZjuHost(url.hostname)) return url;
  }
  return undefined;
}

export function isZjuHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "zju.edu.cn" || host.endsWith(".zju.edu.cn");
}

export class HttpSession {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    readonly jar = new CookieJar(),
  ) {}

  /** Performs exactly one request, without following redirects. */
  async request(url: string | URL, init: RequestInit = {}): Promise<HopResult> {
    const target = new URL(url);
    const response = await this.send(target, init);
    return { response, body: await response.text(), url: target };
  }

  /** Like `request`, for binary responses such as captcha images. */
  async requestBytes(
    url: string | URL,
  ): Promise<{ response: Response; bytes: Uint8Array }> {
    const response = await this.send(new URL(url), {});
    return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
  }

  private async send(target: URL, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    const cookie = this.jar.header(target);
    if (cookie) headers.set("Cookie", cookie);

    const response = await this.fetchImpl(target.toString(), {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.jar.store(response.headers.getSetCookie(), target);
    return response;
  }

  /**
   * GETs `url` and follows HTTP redirects and meta refreshes until a final
   * page is reached. Redirects off the ZJU domain are refused so session
   * cookies and tickets are never sent elsewhere.
   */
  async follow(url: string | URL): Promise<HopResult> {
    let current = new URL(url);
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const result = await this.request(current);
      const { status } = result.response;

      let next: URL | undefined;
      if (status >= 300 && status < 400) {
        const location = result.response.headers.get("location");
        if (!location) throw new Error(`HTTP ${status} 跳转缺少 Location`);
        next = new URL(location, current);
        // Some services redirect back over plain http; stay on https.
        if (next.protocol === "http:") next.protocol = "https:";
      } else if (status >= 200 && status < 300) {
        next = metaRefreshTarget(result.body, current);
      }

      if (!next) return result;
      if (!isZjuHost(next.hostname)) {
        throw new Error(`拒绝跳转到校外地址 ${next.hostname}`);
      }
      current = next;
    }
    throw new Error("跳转次数过多");
  }
}
