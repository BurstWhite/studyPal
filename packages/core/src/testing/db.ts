/**
 * Test helper: an in-memory database with every migration applied. Tests run
 * under Bun, so this is the one place in the package that imports Bun.
 */
import { Database } from "bun:sqlite";
import { migrate, prepareConnection } from "../db";
import type { Db } from "../platform";

export function openDatabase(file = ":memory:"): Database & Db {
  const db = new Database(file, { create: true, strict: true });
  prepareConnection(db);
  migrate(db);
  return db;
}
