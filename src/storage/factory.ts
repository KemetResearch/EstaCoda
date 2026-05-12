import type { OpenSQLiteDatabaseOptions, SQLiteDatabase } from "./sqlite.js";
import { openBetterSQLiteDatabase } from "./better-sqlite3.js";

export function openDefaultSQLiteDatabase(options: OpenSQLiteDatabaseOptions): SQLiteDatabase {
  return openBetterSQLiteDatabase({ ...options, driver: "better-sqlite3" });
}

export async function openSQLiteDatabase(options: OpenSQLiteDatabaseOptions): Promise<SQLiteDatabase> {
  const driver = options.driver ?? "better-sqlite3";

  if (driver === "better-sqlite3") {
    return openBetterSQLiteDatabase(options);
  }

  if (driver === "bun") {
    const { openBunSQLiteDatabase } = await import("./bun-sqlite.js");
    return openBunSQLiteDatabase(options);
  }

  const unreachable: never = driver;
  throw new Error(`Unsupported SQLite driver: ${unreachable}`);
}
