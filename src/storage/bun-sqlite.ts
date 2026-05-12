import { Database } from "bun:sqlite";
import type { OpenSQLiteDatabaseOptions, SQLiteDatabase, SQLiteRunResult, SQLiteStatement, SQLiteValue } from "./sqlite.js";

type BunSQLiteDatabase = InstanceType<typeof Database>;
type BunSQLiteStatement = ReturnType<BunSQLiteDatabase["query"]>;

function normalizeRunResult(result: unknown): SQLiteRunResult {
  const runResult = result as { changes?: unknown; lastInsertRowid?: unknown };
  const lastInsertRowid = runResult.lastInsertRowid;

  return {
    changes: Number(runResult.changes ?? 0),
    lastInsertRowid: typeof lastInsertRowid === "number" || typeof lastInsertRowid === "bigint" ? lastInsertRowid : undefined
  };
}

function normalizeRow<T>(row: unknown): T | null {
  return row === undefined ? null : row as T;
}

class BunSQLiteStatementAdapter<T = unknown> implements SQLiteStatement<T> {
  readonly #statement: BunSQLiteStatement;

  constructor(statement: BunSQLiteStatement) {
    this.#statement = statement;
  }

  run(...params: SQLiteValue[]): SQLiteRunResult {
    return normalizeRunResult(this.#statement.run(...params));
  }

  get(...params: SQLiteValue[]): T | null {
    return normalizeRow<T>(this.#statement.get(...params));
  }

  all(...params: SQLiteValue[]): T[] {
    return this.#statement.all(...params) as T[];
  }
}

class BunSQLiteDatabaseAdapter implements SQLiteDatabase {
  readonly #database: BunSQLiteDatabase;

  constructor(database: BunSQLiteDatabase) {
    this.#database = database;
  }

  exec(sql: string): void {
    this.#database.exec(sql);
  }

  query<T = unknown>(sql: string): SQLiteStatement<T> {
    return new BunSQLiteStatementAdapter<T>(this.#database.query(sql));
  }

  close(): void {
    this.#database.close();
  }
}

export function openBunSQLiteDatabase(options: OpenSQLiteDatabaseOptions): SQLiteDatabase {
  return new BunSQLiteDatabaseAdapter(new Database(options.path, {
    readwrite: options.readonly === true ? false : undefined
  }));
}
