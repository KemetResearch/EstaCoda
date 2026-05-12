import type { OpenSQLiteDatabaseOptions, SQLiteDatabase } from "./sqlite.js";

export async function openSQLiteDatabase(options: OpenSQLiteDatabaseOptions): Promise<SQLiteDatabase> {
  const driver = options.driver ?? "better-sqlite3";

  if (driver === "better-sqlite3") {
    const { openBetterSQLiteDatabase } = await import("./better-sqlite3.js");
    return openBetterSQLiteDatabase(options);
  }

  if (driver === "bun") {
    const { openBunSQLiteDatabase } = await import("./bun-sqlite.js");
    return openBunSQLiteDatabase(options);
  }

  const unreachable: never = driver;
  throw new Error(`Unsupported SQLite driver: ${unreachable}`);
}
