export type SQLiteDriver = "better-sqlite3" | "bun";

export type SQLiteValue = string | number | bigint | Uint8Array | null;

export type SQLiteRunResult = {
  changes: number;
  lastInsertRowid?: number | bigint;
};

export interface SQLiteStatement<T = unknown> {
  run(...params: SQLiteValue[]): SQLiteRunResult;
  get(...params: SQLiteValue[]): T | null;
  all(...params: SQLiteValue[]): T[];
}

export interface SQLiteDatabase {
  exec(sql: string): void;
  query<T = unknown>(sql: string): SQLiteStatement<T>;
  close(): void;
}

export type OpenSQLiteDatabaseOptions = {
  path: string;
  driver?: SQLiteDriver;
  readonly?: boolean;
  timeoutMs?: number;
};
