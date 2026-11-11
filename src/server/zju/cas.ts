/** Login to the ZJU unified authentication service (zjuam.zju.edu.cn). */
import type { HttpSession } from "./http";

const LOGIN_URL = "https://zjuam.zju.edu.cn/cas/login";
const PUBLIC_KEY_URL = "https://zjuam.zju.edu.cn/cas/v2/getPubKey";
const SSO_COOKIE = "iPlanetDirectoryPro";

/** The account was rejected: wrong password, locked, or a captcha is needed. */
export class LoginError extends Error {}

/**
 * Encrypts the password the way the login page does: unpadded RSA over the
 * UTF-8 bytes read as one big-endian integer, as zero-padded hex.
 */
export function encryptPassword(
  password: string,
  modulusHex: string,
  exponentHex: string,
): string {
  const bytes = new TextEncoder().encode(password);
  if (bytes.length === 0) throw new LoginError("密码不能为空");
  const modulus = BigInt(`0x${modulusHex}`);
  let exponent = BigInt(`0x${exponentHex}`);
  let base = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  if (base >= modulus) throw new LoginError("密码过长");

  let result = 1n;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result.toString(16).padStart(modulusHex.length, "0");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The message the login page shows after a rejected attempt. */
export function loginPageError(body: string): string | undefined {
  const match = /id="errormsg"[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  const text = match ? stripTags(match[1]!) : "";
  return text || undefined;
}

/**
 * Signs in and leaves the single sign-on cookie in the session's jar.
 * Throws `LoginError` when the account is rejected.
 */
export async function casLogin(
  session: HttpSession,
  username: string,
  password: string,
): Promise<void> {
  // The execution token and the cookies set here belong to one form session.
  const page = await session.request(LOGIN_URL);
  const execution = /name="execution"\s+value="([^"]+)"/.exec(page.body)?.[1];
  if (!execution) {
    throw new Error(
      `统一身份认证登录页格式有变（HTTP ${page.response.status}）`,
    );
  }

  const keyResponse = await session.request(PUBLIC_KEY_URL);
  let key: { modulus?: string; exponent?: string };
  try {
    key = JSON.parse(keyResponse.body);
  } catch {
    throw new Error("统一身份认证没有返回公钥");
  }
  if (!key.modulus || !key.exponent)
    throw new Error("统一身份认证没有返回公钥");

  const form = new URLSearchParams({
    username,
    password: encryptPassword(password, key.modulus, key.exponent),
    execution,
    _eventId: "submit",
    rememberMe: "true",
  });
  const result = await session.request(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (session.jar.get(SSO_COOKIE, LOGIN_URL)) return;
  throw new LoginError(
    loginPageError(result.body) ??
      `登录失败（HTTP ${result.response.status}），可能需要先在浏览器里完成一次验证`,
  );
}

export function isSignedIn(session: HttpSession): boolean {
  return session.jar.get(SSO_COOKIE, LOGIN_URL) !== undefined;
}
