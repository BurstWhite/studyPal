/**
 * HTTP for the ZJU single sign-on. `HttpSession` (in core) follows each
 * redirect itself and keeps its own cookie jar, so the system must neither
 * follow redirects nor add or store cookies on its own.
 */
import type { FetchLike } from "@studypal/core/platform";
import { fetch as expoFetch } from "expo/fetch";

export const zjuFetch: FetchLike = (url, init = {}) =>
  expoFetch(url, {
    ...(init as object),
    redirect: init.redirect ?? "manual",
    credentials: "omit",
  }) as unknown as Promise<Response>;
