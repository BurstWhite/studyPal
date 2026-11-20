/**
 * `@studypal/core`'s `Db` on top of expo-sqlite's synchronous API, behaving
 * like `bun:sqlite` in strict mode so the shared code runs unchanged:
 *
 * - named parameters are bound from objects whose keys leave out the `$`;
 * - booleans are stored as 0 and 1;
 * - `run` reports `lastInsertRowid` (lower-case `id`);
 * - `transaction` nests, using savepoints inside an outer transaction.
 */
import type { Db, Statement } from "@studypal/core/platform";
import type {
  SQLiteBindParams,
  SQLiteBindValue,
  SQLiteDatabase,
} from "expo-sqlite";

/** The synchronous part of expo-sqlite's database that the wrapper uses. */
export type SyncSqlite = Pick<
  SQLiteDatabase,
  "getAllSync" | "getFirstSync" | "runSync" | "execSync"
>;

function bindValue(value: unknown): SQLiteBindValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  return value as SQLiteBindValue;
}

function isNamed(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Uint8Array) &&
    !Array.isArray(value)
  );
}

/** The `$name` parameters a statement uses, with their prefix. */
export function parameterNames(sql: string): string[] {
  const withoutStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  return [...new Set(withoutStrings.match(/[$:@][A-Za-z_]\w*/g) ?? [])];
}

/**
 * Converts `bun:sqlite`-style arguments into expo-sqlite parameters. For an
 * object, only the names the statement uses are bound (Bun ignores extra
 * keys; SQLite would reject them), and absent ones are bound as NULL.
 */
export function bindParams(args: unknown[], names: string[]): SQLiteBindParams {
  if (args.length === 1 && isNamed(args[0])) {
    const given = args[0];
    const named: Record<string, SQLiteBindValue> = {};
    for (const name of names) {
      const key = name.slice(1);
      named[name] = bindValue(key in given ? given[key] : given[name]);
    }
    return named;
  }
  return args.map(bindValue);
}

export function wrapDatabase(sqlite: SyncSqlite): Db {
  let depth = 0;

  const query = (sql: string): Statement => {
    const names = parameterNames(sql);
    const bind = (args: unknown[]) => bindParams(args, names);
    return {
      all: (...args) => sqlite.getAllSync(sql, bind(args)),
      get: (...args) => sqlite.getFirstSync(sql, bind(args)),
      run: (...args) => {
        const result = sqlite.runSync(sql, bind(args));
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowId,
        };
      },
    };
  };

  return {
    query,
    exec: (sql) => sqlite.execSync(sql),
    transaction:
      (fn) =>
      (...args) => {
        const savepoint = `studypal_${depth}`;
        sqlite.execSync(depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
        depth++;
        try {
          fn(...args);
          depth--;
          sqlite.execSync(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        } catch (error) {
          depth--;
          sqlite.execSync(
            depth === 0
              ? "ROLLBACK"
              : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`,
          );
          throw error;
        }
      },
  };
}
