import Database from "better-sqlite3";
import type { OpenSQLiteDatabaseOptions, SQLiteDatabase, SQLiteRunResult, SQLiteStatement, SQLiteValue } from "./sqlite.js";

type BetterSQLiteDatabase = Database.Database;
type BetterSQLiteStatement = Database.Statement;
type BetterSQLiteRunResult = Database.RunResult;

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

function normalizeRunResult(result: BetterSQLiteRunResult): SQLiteRunResult {
  return {
    changes: Number(result.changes),
    lastInsertRowid: result.lastInsertRowid
  };
}

function normalizeRow<T>(row: unknown): T | null {
  return row === undefined ? null : row as T;
}

class BetterSQLiteStatementAdapter<T = unknown> implements SQLiteStatement<T> {
  readonly #statement: BetterSQLiteStatement;

  constructor(statement: BetterSQLiteStatement) {
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

class BetterSQLiteDatabaseAdapter implements SQLiteDatabase {
  readonly #database: BetterSQLiteDatabase;

  constructor(database: BetterSQLiteDatabase) {
    this.#database = database;
  }

  exec(sql: string): void {
    this.#database.exec(sql);
  }

  query<T = unknown>(sql: string): SQLiteStatement<T> {
    return new BetterSQLiteStatementAdapter<T>(this.#database.prepare(sql));
  }

  close(): void {
    this.#database.close();
  }
}

export function openBetterSQLiteDatabase(options: OpenSQLiteDatabaseOptions): SQLiteDatabase {
  const databaseOptions: Database.Options = {};
  if (options.readonly !== undefined) {
    databaseOptions.readonly = options.readonly;
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  databaseOptions.timeout = timeoutMs;

  const database = new Database(options.path, databaseOptions);
  database.pragma(`busy_timeout = ${timeoutMs}`);

  return new BetterSQLiteDatabaseAdapter(database);
}
