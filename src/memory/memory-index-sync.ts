import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MemoryConfig, MemoryIndexBackfillOnStartup } from "../config/memory-config.js";
import { DEFAULT_MEMORY_CONFIG } from "../config/memory-config.js";
import { resolveGlobalStateHome, resolveProfileStateHome } from "../config/profile-home.js";
import type { MemoryFileKind, MemoryIndexedSourceType, MemoryProtectedClass } from "../contracts/memory.js";
import { redactSensitiveText } from "../utils/redaction.js";
import { MemoryIndex, type MemoryIndexStatus } from "./memory-index.js";
import { MemoryIndexStore, resolveMemoryIndexStorePath } from "./memory-index-store.js";
import { listSharedMemory } from "./shared-memory.js";

const PROFILE_MEMORY_FILE_KINDS: readonly Extract<MemoryFileKind, "USER.md" | "MEMORY.md" | "SOUL.md">[] = [
  "USER.md",
  "MEMORY.md",
  "SOUL.md"
];

export type MemoryIndexSyncDiagnosticCode =
  | "memory-index-disabled"
  | "memory-index-missing"
  | "memory-index-empty"
  | "memory-index-backfill-skipped"
  | "memory-index-backfill-completed"
  | "memory-index-sync-failed"
  | "memory-index-stale-entries";

export type MemoryIndexSyncDiagnostic = {
  code: MemoryIndexSyncDiagnosticCode;
  message: string;
  sourceType?: MemoryIndexedSourceType;
  sourceId?: string;
  memoryFileKind?: MemoryFileKind;
};

export type MemoryIndexSyncDiagnostics = {
  path: string;
  profileId: string;
  enabled: boolean;
  available: boolean;
  lastBackfillAt?: string;
  lastRebuildAt?: string;
  pendingRebuildReason?: string;
  staleEntries: number;
  protectedEntries: number;
  indexedEntries: number;
  indexedProfiles: number;
  ftsHealthy: boolean;
  empty: boolean;
  missingIndexFile: boolean;
  warnings: string[];
  diagnostics: MemoryIndexSyncDiagnostic[];
};

export type MemoryIndexBackfillResult = {
  mode: MemoryIndexBackfillOnStartup;
  indexedEntries: number;
  diagnostics: MemoryIndexSyncDiagnostics;
};

export type MemoryIndexSyncWriteResult = {
  ok: boolean;
  warning?: string;
  diagnostics: MemoryIndexSyncDiagnostics;
};

export type MemoryIndexSyncOptions = {
  index: MemoryIndex;
  store: MemoryIndexStore;
  profileId: string;
  homeDir?: string;
  config?: MemoryConfig;
  now?: () => Date;
  indexFileMissingAtStartup?: boolean;
};

export type CreateMemoryIndexSyncOptions = Omit<MemoryIndexSyncOptions, "index" | "store" | "indexFileMissingAtStartup"> & {
  storePath?: string;
};

export type MemoryIndexWriteSync = {
  syncMemoryFile(input: {
    file: MemoryFileKind;
    content: string;
    sourcePath?: string;
  }): Promise<MemoryIndexSyncWriteResult> | MemoryIndexSyncWriteResult;
};

type IndexedSourceIdentity = {
  sourceType: MemoryIndexedSourceType;
  sourceId: string;
};

type IndexedSourceRow = {
  source_type: MemoryIndexedSourceType;
  source_id: string;
};

export class MemoryIndexSync {
  readonly #index: MemoryIndex;
  readonly #store: MemoryIndexStore;
  readonly #profileId: string;
  readonly #homeDir: string | undefined;
  readonly #config: MemoryConfig;
  readonly #now: () => Date;
  readonly #indexFileMissingAtStartup: boolean;
  #lastBackfillAt: string | undefined;
  #lastRebuildAt: string | undefined;
  #warnings: string[] = [];
  #diagnostics: MemoryIndexSyncDiagnostic[] = [];

  constructor(options: MemoryIndexSyncOptions) {
    this.#index = options.index;
    this.#store = options.store;
    this.#profileId = options.profileId;
    this.#homeDir = options.homeDir;
    this.#config = options.config ?? DEFAULT_MEMORY_CONFIG;
    this.#now = options.now ?? (() => new Date());
    this.#indexFileMissingAtStartup = options.indexFileMissingAtStartup === true;
    this.#lastBackfillAt = this.#store.readMetadata("lastBackfillAt");
    this.#lastRebuildAt = this.#store.readMetadata("lastRebuildAt");
  }

  diagnostics(): MemoryIndexSyncDiagnostics {
    return this.#buildDiagnostics(this.#index.status({ profileId: this.#profileId }));
  }

  dispose(): void {
    this.#store.dispose();
  }

  async backfillOnStartup(): Promise<MemoryIndexBackfillResult> {
    const mode = this.#config.index.reindexOnStartup ? "full" : this.#config.index.backfillOnStartup;

    if (!this.#config.index.enabled) {
      this.#addDiagnostic({
        code: "memory-index-disabled",
        message: "Local memory index backfill skipped because memory.index.enabled is false."
      });
      return {
        mode,
        indexedEntries: 0,
        diagnostics: this.diagnostics()
      };
    }

    if (mode === "off") {
      this.#addDiagnostic({
        code: "memory-index-backfill-skipped",
        message: "Local memory index startup backfill skipped by configuration."
      });
      return {
        mode,
        indexedEntries: 0,
        diagnostics: this.diagnostics()
      };
    }

    const startedAt = this.#now().toISOString();
    const indexedEntries = mode === "full"
      ? await this.#fullBackfill(startedAt)
      : await this.#boundedBackfill(startedAt);

    this.#lastBackfillAt = startedAt;
    this.#store.writeMetadata("lastBackfillAt", startedAt);
    if (this.#config.index.reindexOnStartup) {
      this.#lastRebuildAt = startedAt;
      this.#store.writeMetadata("lastRebuildAt", startedAt);
    }
    this.#addDiagnostic({
      code: "memory-index-backfill-completed",
      message: `Local memory index ${mode} startup backfill completed.`
    });

    return {
      mode,
      indexedEntries,
      diagnostics: this.diagnostics()
    };
  }

  async rebuild(): Promise<MemoryIndexBackfillResult> {
    if (!this.#config.index.enabled) {
      this.#addDiagnostic({
        code: "memory-index-disabled",
        message: "Local memory index rebuild skipped because memory.index.enabled is false."
      });
      return {
        mode: "full",
        indexedEntries: 0,
        diagnostics: this.diagnostics()
      };
    }

    const startedAt = this.#now().toISOString();
    const indexedEntries = await this.#fullBackfill(startedAt);
    this.#lastBackfillAt = startedAt;
    this.#lastRebuildAt = startedAt;
    this.#store.writeMetadata("lastBackfillAt", startedAt);
    this.#store.writeMetadata("lastRebuildAt", startedAt);
    this.#addDiagnostic({
      code: "memory-index-backfill-completed",
      message: "Local memory index explicit rebuild completed."
    });

    return {
      mode: "full",
      indexedEntries,
      diagnostics: this.diagnostics()
    };
  }

  async syncMemoryFile(input: {
    file: MemoryFileKind;
    content: string;
    sourcePath?: string;
  }): Promise<MemoryIndexSyncWriteResult> {
    if (!this.#config.index.enabled) {
      return {
        ok: true,
        diagnostics: this.diagnostics()
      };
    }

    try {
      if (!isProfileMemoryFileKind(input.file)) {
        return {
          ok: true,
          diagnostics: this.diagnostics()
        };
      }
      this.#index.indexMemoryFile({
        profileId: this.#profileId,
        memoryFileKind: input.file,
        content: input.content,
        sourcePath: input.sourcePath ?? this.#profilePaths()[pathKeyForMemoryFile(input.file)],
        updatedAt: this.#now().toISOString(),
        indexedAt: this.#now().toISOString()
      });
      return {
        ok: true,
        diagnostics: this.diagnostics()
      };
    } catch (error) {
      const warning = syncWarning(input.file, error);
      this.#warnings.push(warning);
      this.#addDiagnostic({
        code: "memory-index-sync-failed",
        message: warning,
        sourceType: "memory_file",
        sourceId: input.file,
        memoryFileKind: input.file
      });
      return {
        ok: false,
        warning,
        diagnostics: this.diagnostics()
      };
    }
  }

  async syncSharedMemory(input: {
    sourceKey: string;
    content: string;
    sourcePath?: string;
    protectedClass?: MemoryProtectedClass;
  }): Promise<MemoryIndexSyncWriteResult> {
    if (!this.#config.index.enabled) {
      return {
        ok: true,
        diagnostics: this.diagnostics()
      };
    }

    try {
      validateSharedMemoryKey(input.sourceKey);
      this.#index.indexSharedMemory({
        profileId: this.#profileId,
        sourceKey: input.sourceKey,
        content: input.content,
        sourcePath: input.sourcePath,
        protectedClass: input.protectedClass ?? "none",
        updatedAt: this.#now().toISOString(),
        indexedAt: this.#now().toISOString()
      });
      return {
        ok: true,
        diagnostics: this.diagnostics()
      };
    } catch (error) {
      const warning = syncWarning(input.sourceKey, error);
      this.#warnings.push(warning);
      this.#addDiagnostic({
        code: "memory-index-sync-failed",
        message: warning,
        sourceType: "shared_memory",
        sourceId: input.sourceKey
      });
      return {
        ok: false,
        warning,
        diagnostics: this.diagnostics()
      };
    }
  }

  async #boundedBackfill(indexedAt: string): Promise<number> {
    const entries = await this.#readProfileMemoryFiles(indexedAt);
    for (const entry of entries) {
      this.#index.indexMemoryFile(entry);
    }
    return entries.length;
  }

  async #fullBackfill(indexedAt: string): Promise<number> {
    const memoryFiles = await this.#readProfileMemoryFiles(indexedAt);
    const sharedMemory = await listSharedMemory({ homeDir: this.#homeDir });
    const sharedInputs = sharedMemory.map((entry) => ({
      profileId: this.#profileId,
      sourceKey: entry.key,
      content: entry.content,
      sourcePath: join(resolveGlobalStateHome({ homeDir: this.#homeDir }).sharedMemoryPath, `${entry.key}.md`),
      updatedAt: entry.updatedAt.toISOString(),
      indexedAt,
      protectedClass: "none" as const
    }));

    this.#index.reindexProfile({
      profileId: this.#profileId,
      memoryFiles,
      sharedMemory: sharedInputs
    });
    return memoryFiles.length + sharedInputs.length;
  }

  async #readProfileMemoryFiles(indexedAt: string): Promise<Array<{
    profileId: string;
    memoryFileKind: Extract<MemoryFileKind, "USER.md" | "MEMORY.md" | "SOUL.md">;
    content: string;
    sourcePath: string;
    updatedAt: string;
    indexedAt: string;
  }>> {
    const paths = this.#profilePaths();
    const entries = [];
    for (const kind of PROFILE_MEMORY_FILE_KINDS) {
      const sourcePath = paths[pathKeyForMemoryFile(kind)];
      const content = await readOptionalFile(sourcePath);
      if (content === undefined) {
        continue;
      }
      const metadata = await stat(sourcePath);
      entries.push({
        profileId: this.#profileId,
        memoryFileKind: kind,
        content,
        sourcePath,
        updatedAt: metadata.mtime.toISOString(),
        indexedAt
      });
    }
    return entries;
  }

  #buildDiagnostics(status: MemoryIndexStatus): MemoryIndexSyncDiagnostics {
    const staleEntries = this.#detectStaleEntries();
    const staleDiagnostics = staleEntries > 0
      ? [{
        code: "memory-index-stale-entries",
        message: "The local memory index contains entries whose authoritative source is no longer present."
      } as const]
      : [];
    const pendingRebuildReason = this.#pendingRebuildReason(status, staleEntries);

    return {
      path: this.#store.path,
      profileId: this.#profileId,
      enabled: this.#config.index.enabled,
      available: status.available,
      lastBackfillAt: this.#lastBackfillAt,
      lastRebuildAt: this.#lastRebuildAt,
      pendingRebuildReason,
      staleEntries,
      protectedEntries: status.protectedEntries,
      indexedEntries: status.indexedEntries,
      indexedProfiles: status.indexedProfiles,
      ftsHealthy: status.ftsHealthy,
      empty: status.empty,
      missingIndexFile: this.#indexFileMissingAtStartup,
      warnings: [...this.#warnings],
      diagnostics: [
        ...this.#diagnostics,
        ...staleDiagnostics,
        ...(status.empty ? [{
          code: "memory-index-empty" as const,
          message: "The local memory index is empty."
        }] : []),
        ...(this.#indexFileMissingAtStartup ? [{
          code: "memory-index-missing" as const,
          message: "memory-index.sqlite was missing at startup and may need rebuild/backfill."
        }] : [])
      ]
    };
  }

  #pendingRebuildReason(status: MemoryIndexStatus, staleEntries: number): string | undefined {
    if (!this.#config.index.enabled) {
      return "index disabled";
    }
    if (this.#indexFileMissingAtStartup) {
      return "missing memory-index.sqlite at startup";
    }
    if (status.empty) {
      return "empty index";
    }
    if (staleEntries > 0) {
      return "stale indexed sources";
    }
    return undefined;
  }

  #detectStaleEntries(): number {
    const rows = this.#store.db
      .query<IndexedSourceRow>(
        `select source_type, source_id
         from memory_index
         where profile_id = ?
         group by source_type, source_id`
      )
      .all(this.#profileId);
    let stale = 0;
    for (const row of rows) {
      if (!this.#sourceExists({
        sourceType: row.source_type,
        sourceId: row.source_id
      })) {
        stale++;
      }
    }
    return stale;
  }

  #sourceExists(source: IndexedSourceIdentity): boolean {
    if (source.sourceType === "memory_file" && isProfileMemoryFileKind(source.sourceId)) {
      return existsSync(this.#profilePaths()[pathKeyForMemoryFile(source.sourceId)]);
    }
    if (source.sourceType === "shared_memory") {
      const globalPaths = resolveGlobalStateHome({ homeDir: this.#homeDir });
      const filename = basename(source.sourceId).endsWith(".md") ? basename(source.sourceId) : `${basename(source.sourceId)}.md`;
      return existsSync(join(globalPaths.sharedMemoryPath, filename));
    }
    return false;
  }

  #profilePaths(): ReturnType<typeof resolveProfileStateHome> {
    return resolveProfileStateHome({
      homeDir: this.#homeDir,
      profileId: this.#profileId
    });
  }

  #addDiagnostic(diagnostic: MemoryIndexSyncDiagnostic): void {
    if (this.#diagnostics.some((existing) =>
      existing.code === diagnostic.code &&
      existing.sourceType === diagnostic.sourceType &&
      existing.sourceId === diagnostic.sourceId &&
      existing.memoryFileKind === diagnostic.memoryFileKind
    )) {
      return;
    }
    this.#diagnostics.push(diagnostic);
  }
}

export function createMemoryIndexSync(options: CreateMemoryIndexSyncOptions): MemoryIndexSync {
  const path = options.storePath ?? resolveMemoryIndexStorePath({
    homeDir: options.homeDir,
    profileId: options.profileId
  });
  const missingAtStartup = !existsSync(path);
  const store = new MemoryIndexStore({ path });
  const index = new MemoryIndex({
    store,
    now: options.now
  });
  return new MemoryIndexSync({
    ...options,
    store,
    index,
    indexFileMissingAtStartup: missingAtStartup
  });
}

function pathKeyForMemoryFile(kind: MemoryFileKind): "userMdPath" | "memoryMdPath" | "soulMdPath" {
  if (kind === "USER.md") {
    return "userMdPath";
  }
  if (kind === "MEMORY.md") {
    return "memoryMdPath";
  }
  return "soulMdPath";
}

function isProfileMemoryFileKind(value: string): value is Extract<MemoryFileKind, "USER.md" | "MEMORY.md" | "SOUL.md"> {
  return value === "USER.md" || value === "MEMORY.md" || value === "SOUL.md";
}

function validateSharedMemoryKey(value: string): void {
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(key) || key === "." || key === "..") {
    throw new Error(`Invalid shared memory key: ${value}`);
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function syncWarning(source: string, error: unknown): string {
  const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
  return `memory index sync failed for ${source}: ${message}`;
}
