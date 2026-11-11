/**
 * The saved ZJU account. The username lives in the settings table; the
 * password only ever goes to the system keychain.
 */
import type { Database } from "bun:sqlite";
import { secrets } from "bun";
import { config } from "../config";
import type { Credentials } from "./sync";

const SERVICE = config.secretService;
const SECRET_NAME = "zju-password";
const USERNAME_KEY = "zju_username";

export function savedUsername(db: Database): string | undefined {
  const row = db
    .query("SELECT value FROM settings WHERE key = ?")
    .get(USERNAME_KEY) as {
    value: string;
  } | null;
  return row ? (JSON.parse(row.value) as string) : undefined;
}

export async function loadCredentials(
  db: Database,
): Promise<Credentials | undefined> {
  const username = savedUsername(db);
  if (!username) return undefined;
  const password = await secrets.get({ service: SERVICE, name: SECRET_NAME });
  return password ? { username, password } : undefined;
}

export async function saveCredentials(
  db: Database,
  credentials: Credentials,
): Promise<void> {
  await secrets.set({
    service: SERVICE,
    name: SECRET_NAME,
    value: credentials.password,
  });
  db.query(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(USERNAME_KEY, JSON.stringify(credentials.username));
}

export async function clearCredentials(db: Database): Promise<void> {
  await secrets.delete({ service: SERVICE, name: SECRET_NAME });
  db.query("DELETE FROM settings WHERE key = ?").run(USERNAME_KEY);
}
