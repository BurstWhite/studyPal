/** The app's SQLite database, in its documents folder. */
import { migrate, prepareConnection } from "@studypal/core/db";
import type { Db } from "@studypal/core/platform";
import { openDatabaseSync } from "expo-sqlite";
import { wrapDatabase } from "./sqliteDb";

/** Opens the app's database and brings its schema up to date. */
export function openAppDatabase(): Db {
  const db = wrapDatabase(openDatabaseSync("studypal.sqlite"));
  prepareConnection(db);
  migrate(db);
  return db;
}
