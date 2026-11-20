/**
 * The saved ZJU account. The username lives in the settings table; the
 * password only ever goes to the system keychain.
 */
import type { Db } from "../platform";
import { platform } from "../platform";
import type { Credentials } from "./sync";

const SECRET_NAME = "zju-password";
const USERNAME_KEY = "zju_username";

export function savedUsername(db: Db): string | undefined {
  const row = db
    .query("SELECT value FROM settings WHERE key = ?")
    .get(USERNAME_KEY) as {
    value: string;
  } | null;
  return row ? (JSON.parse(row.value) as string) : undefined;
}

export async function loadCredentials(
  db: Db,
): Promise<Credentials | undefined> {
  const username = savedUsername(db);
  if (!username) return undefined;
  const password = await platform().secrets.get(SECRET_NAME);
  return password ? { username, password } : undefined;
}

export async function saveCredentials(
  db: Db,
  credentials: Credentials,
): Promise<void> {
  await platform().secrets.set(SECRET_NAME, credentials.password);
  db.query(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(USERNAME_KEY, JSON.stringify(credentials.username));
}

export async function clearCredentials(db: Db): Promise<void> {
  await platform().secrets.delete(SECRET_NAME);
  db.query("DELETE FROM settings WHERE key = ?").run(USERNAME_KEY);
}
