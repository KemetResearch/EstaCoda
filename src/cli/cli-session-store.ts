import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

type CliSessionFile = {
  version: 1;
  entries: CliSessionEntry[];
};

type CliSessionEntry = {
  workspaceRoot: string;
  sessionId: string;
  updatedAt: string;
};

export class PersistentCliSessionStore {
  readonly #path: string;
  readonly #entries = new Map<string, CliSessionEntry>();
  #loaded = false;

  constructor(options: { path?: string; homeDir?: string } = {}) {
    this.#path = options.path ?? join(options.homeDir ?? homedir(), ".estacoda", "cli-sessions.json");
  }

  get path(): string {
    return this.#path;
  }

  async getSessionId(workspaceRoot: string): Promise<string | undefined> {
    await this.#ensureLoaded();
    return this.#entries.get(normalizeWorkspaceRoot(workspaceRoot))?.sessionId;
  }

  async setSessionId(workspaceRoot: string, sessionId: string): Promise<void> {
    await this.#ensureLoaded();
    this.#entries.set(normalizeWorkspaceRoot(workspaceRoot), {
      workspaceRoot: normalizeWorkspaceRoot(workspaceRoot),
      sessionId,
      updatedAt: new Date().toISOString()
    });
    await this.#flush();
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) {
      return;
    }

    this.#loaded = true;

    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as Partial<CliSessionFile>;
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

      for (const entry of entries) {
        if (typeof entry.workspaceRoot !== "string" || typeof entry.sessionId !== "string") {
          continue;
        }

        this.#entries.set(normalizeWorkspaceRoot(entry.workspaceRoot), {
          workspaceRoot: normalizeWorkspaceRoot(entry.workspaceRoot),
          sessionId: entry.sessionId,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString()
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async #flush(): Promise<void> {
    const file: CliSessionFile = {
      version: 1,
      entries: [...this.#entries.values()].sort((left, right) => left.workspaceRoot.localeCompare(right.workspaceRoot))
    };

    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot);
}
