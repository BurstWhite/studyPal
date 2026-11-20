/**
 * What studyPal's logic needs from the system it runs on. The desktop server
 * (Bun) and the phone app (Expo) each provide these once at startup with
 * `configurePlatform`; nothing in this package imports Bun or React Native.
 */
import type { HelperRunner } from "./calendar/system";

/** Values that can be bound to a SQL statement. */
export type SqlValue = string | number | bigint | boolean | null | Uint8Array;
export type SqlParams = SqlValue[] | [Record<string, SqlValue | undefined>];

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * A prepared statement. Named parameters are written `$name` in SQL and bound
 * from an object whose keys leave out the `$`, as `bun:sqlite` does in strict
 * mode.
 */
export interface Statement {
  all(...params: any[]): unknown[];
  /** `null` when there is no row. */
  get(...params: any[]): unknown;
  run(...params: any[]): RunResult;
}

/** The part of a SQLite connection studyPal uses; `bun:sqlite` fits it as is. */
export interface Db {
  query(sql: string): Statement;
  /** Runs one or more statements that take no parameters. */
  exec(sql: string): unknown;
  /** Wraps `fn` so that each call runs inside one transaction. */
  transaction<A extends any[]>(fn: (...args: A) => void): (...args: A) => void;
}

/** Secrets (passwords, API keys) kept in the system keychain. */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Platform {
  /** Opens (and migrates) the app's database. Called once, on first use. */
  openDb(): Db;
  secrets: SecretStore;
  /** Writes into the system calendar. */
  calendar: HelperRunner;
  /**
   * HTTP for the ZJU sites. Must honour `redirect: "manual"` and return each
   * `Set-Cookie` header through `headers.getSetCookie()`.
   */
  zjuFetch: FetchLike;
  /** Opens a web page in the system browser. */
  openUrl(url: string): Promise<void>;
  /** When this build was made, shown in settings; empty in development. */
  builtAt: string;
}

let current: Platform | undefined;

export function configurePlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (!current) throw new Error("configurePlatform() has not been called");
  return current;
}

/** For tests: whether a platform has been configured. */
export function hasPlatform(): boolean {
  return current !== undefined;
}
