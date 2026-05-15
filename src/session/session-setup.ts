import { mkdir, chmod, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveStateHome } from "../config/state-home.js";
import { SQLiteSessionDB } from "./sqlite-session-db.js";

function isFileAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export async function prepareSessionDbFile(path: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  try {
    await writeFile(path, "", { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!isFileAlreadyExistsError(error)) {
      throw error;
    }
    await chmod(path, 0o600).catch(() => undefined);
  }
}

export async function createSQLiteSessionDB(options?: { path?: string }): Promise<SQLiteSessionDB> {
  const stateHome = resolveStateHome();
  const sessionDbPath = options?.path ?? stateHome.sessionsSqlitePath;
  await prepareSessionDbFile(sessionDbPath);
  return new SQLiteSessionDB({ path: sessionDbPath });
}
