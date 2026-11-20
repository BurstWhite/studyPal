/**
 * iOS joins repeated `Set-Cookie` headers into one, separated by ", ". A comma
 * starts a new cookie only where `name=` follows; the comma inside
 * `Expires=Wed, 21 Oct 2037 …` is followed by a date. Cookie values cannot
 * contain commas (RFC 6265 cookie-octet), so the split is unambiguous.
 */
export function splitSetCookie(joined: string): string[] {
  return joined
    .split(/,(?=\s*[^;,=\s]+=[^;,]*)/)
    .map((cookie) => cookie.trim())
    .filter(Boolean);
}
