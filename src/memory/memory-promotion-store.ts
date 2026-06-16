import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MemoryPromotionRecord } from "../contracts/memory.js";
import type { MemoryPersistenceService } from "./memory-persistence-service.js";

type PromotionFile = {
  version: 1;
  records: MemoryPromotionRecord[];
};

export class MemoryPromotionStore {
  readonly #path: string;
  readonly #now: () => Date;
  readonly #persistence: MemoryPersistenceService | undefined;
  readonly #records = new Map<string, MemoryPromotionRecord>();
  #loaded = false;

  constructor(options: { path: string; now?: () => Date; persistence?: MemoryPersistenceService }) {
    this.#path = options.path;
    this.#now = options.now ?? (() => new Date());
    this.#persistence = options.persistence;
  }

  async applyUserPreference(input: {
    id: string;
    content: string;
    confidence: number;
    occurrences: number;
    source: string;
    sourceSessionIds: string[];
    sourceTrajectoryId?: string;
    sourceEventId?: string;
  }): Promise<{
    action: "created" | "strengthened" | "replaced";
    record: MemoryPromotionRecord;
    superseded?: MemoryPromotionRecord;
  }> {
    await this.#ensureLoaded();
    const previousRecords = new Map(this.#records);
    const now = this.#now().toISOString();
    const key = normalizeContentKey(input.content);
    const existing = this.#records.get(key);

    if (existing !== undefined) {
      const updated: MemoryPromotionRecord = {
        ...existing,
        active: true,
        confidence: Math.max(existing.confidence, input.confidence),
        occurrences: Math.max(existing.occurrences, input.occurrences),
        sourceSessionIds: unique([...existing.sourceSessionIds, ...input.sourceSessionIds]),
        updatedAt: now
      };
      this.#records.set(key, updated);
      await this.#flushWithRollback(previousRecords);
      return {
        action: "strengthened",
        record: updated
      };
    }

    const category = classifyPreferenceCategory(input.content);
    const conflicting = category === undefined ? undefined : this.#findActiveConflict(category, input.content);
    const record: MemoryPromotionRecord = {
      id: input.id,
      kind: "user-preference",
      content: input.content,
      active: true,
      confidence: input.confidence,
      occurrences: input.occurrences,
      source: input.source,
      sourceSessionIds: unique(input.sourceSessionIds),
      updatedAt: now,
      createdAt: now,
      sourceTrajectoryId: input.sourceTrajectoryId,
      sourceEventId: input.sourceEventId
    };

    if (conflicting !== undefined) {
      const retired: MemoryPromotionRecord = {
        ...conflicting,
        active: false,
        supersededBy: record.id,
        updatedAt: now
      };
      this.#records.set(normalizeContentKey(retired.content), retired);
      this.#records.set(key, record);
      await this.#flushWithRollback(previousRecords);
      return {
        action: "replaced",
        record,
        superseded: retired
      };
    }

    this.#records.set(key, record);
    await this.#flushWithRollback(previousRecords);
    return {
      action: "created",
      record
    };
  }

  async applyProjectFact(input: {
    id: string;
    content: string;
    confidence: number;
    occurrences: number;
    source: string;
    sourceSessionIds: string[];
    sourceTrajectoryId?: string;
    sourceEventId?: string;
  }): Promise<{
    action: "created" | "strengthened";
    record: MemoryPromotionRecord;
  }> {
    await this.#ensureLoaded();
    const previousRecords = new Map(this.#records);
    const now = this.#now().toISOString();
    const key = normalizeContentKey(input.content);
    const existing = this.#records.get(key);

    if (existing !== undefined) {
      const updated: MemoryPromotionRecord = {
        ...existing,
        active: true,
        confidence: Math.max(existing.confidence, input.confidence),
        occurrences: Math.max(existing.occurrences, input.occurrences),
        sourceSessionIds: unique([...existing.sourceSessionIds, ...input.sourceSessionIds]),
        updatedAt: now
      };
      this.#records.set(key, updated);
      await this.#flushWithRollback(previousRecords);
      return {
        action: "strengthened",
        record: updated
      };
    }

    const record: MemoryPromotionRecord = {
      id: input.id,
      kind: "project-fact",
      content: input.content,
      active: true,
      confidence: input.confidence,
      occurrences: input.occurrences,
      source: input.source,
      sourceSessionIds: unique(input.sourceSessionIds),
      updatedAt: now,
      createdAt: now,
      sourceTrajectoryId: input.sourceTrajectoryId,
      sourceEventId: input.sourceEventId
    };
    this.#records.set(key, record);
    await this.#flushWithRollback(previousRecords);
    return {
      action: "created",
      record
    };
  }

  async forgetUserPreference(content: string): Promise<MemoryPromotionRecord | undefined> {
    await this.#ensureLoaded();
    const previousRecords = new Map(this.#records);
    const match = this.#findMatchingActiveRecord(content);
    if (match === undefined) {
      return undefined;
    }

    const forgotten: MemoryPromotionRecord = {
      ...match,
      active: false,
      forgottenAt: this.#now().toISOString(),
      forgottenReason: "user-requested",
      updatedAt: this.#now().toISOString()
    };
    this.#records.set(normalizeContentKey(match.content), forgotten);
    await this.#flushWithRollback(previousRecords);
    return forgotten;
  }

  async findById(id: string): Promise<MemoryPromotionRecord | undefined> {
    await this.#ensureLoaded();
    return [...this.#records.values()].find((record) => record.id === id);
  }

  async deactivateById(id: string): Promise<MemoryPromotionRecord | undefined> {
    await this.#ensureLoaded();
    const previousRecords = new Map(this.#records);
    const record = [...this.#records.values()].find((r) => r.id === id);
    if (record === undefined) {
      return undefined;
    }
    const deactivated: MemoryPromotionRecord = {
      ...record,
      active: false,
      updatedAt: this.#now().toISOString()
    };
    this.#records.set(normalizeContentKey(record.content), deactivated);
    await this.#flushWithRollback(previousRecords);
    return deactivated;
  }

  async list(): Promise<MemoryPromotionRecord[]> {
    await this.#ensureLoaded();
    return [...this.#records.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async restore(records: readonly MemoryPromotionRecord[]): Promise<void> {
    await this.#ensureLoaded();
    const previousRecords = new Map(this.#records);
    this.#records.clear();
    for (const record of records) {
      this.#records.set(normalizeContentKey(record.content), record);
    }
    await this.#flushWithRollback(previousRecords);
  }

  #findMatchingActiveRecord(content: string): MemoryPromotionRecord | undefined {
    const target = normalizeContentKey(content);
    const exact = this.#records.get(target);
    if (exact?.active) {
      return exact;
    }

    return [...this.#records.values()].find((record) =>
      record.active && normalizeContentKey(record.content) === target
    );
  }

  #findActiveConflict(category: string, nextContent: string): MemoryPromotionRecord | undefined {
    return [...this.#records.values()].find((record) =>
      record.active &&
      record.kind === "user-preference" &&
      record.content !== nextContent &&
      classifyPreferenceCategory(record.content) === category
    );
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) {
      return;
    }

    this.#loaded = true;
    try {
      const content = this.#persistence === undefined
        ? await readFile(this.#path, "utf8")
        : await this.#persistence.readFile({
            path: this.#path,
            kind: "promotions.json"
          });
      if (content === undefined) {
        return;
      }
      const parsed = JSON.parse(content) as Partial<PromotionFile>;
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      for (const record of records) {
        if (typeof record?.content !== "string" || typeof record?.id !== "string") {
          continue;
        }
        this.#records.set(normalizeContentKey(record.content), record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async #flush(): Promise<void> {
    const file: PromotionFile = {
      version: 1,
      records: [...this.#records.values()].sort((left, right) => left.content.localeCompare(right.content))
    };
    const content = `${JSON.stringify(file, null, 2)}\n`;
    if (this.#persistence !== undefined) {
      await this.#persistence.writeFile({
        path: this.#path,
        kind: "promotions.json",
        content
      });
      return;
    }
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, content, "utf8");
  }

  async #flushWithRollback(previousRecords: Map<string, MemoryPromotionRecord>): Promise<void> {
    try {
      await this.#flush();
    } catch (error) {
      this.#records.clear();
      for (const [key, record] of previousRecords.entries()) {
        this.#records.set(key, record);
      }
      throw error;
    }
  }
}

function normalizeContentKey(content: string): string {
  return content.trim().toLowerCase();
}

function classifyPreferenceCategory(content: string): string | undefined {
  const normalized = normalizeContentKey(content);
  if (/^prefer (?:concise|detailed|brief) replies\.$/u.test(normalized)) {
    return "reply-verbosity";
  }
  if (/^prefer (?:npm|pnpm|yarn|bun)\.$/u.test(normalized)) {
    return "package-manager";
  }
  if (/^prefer (?:npm|pnpm|yarn|bun) test\.$/u.test(normalized)) {
    return "test-command";
  }
  if (/^prefer (?:typescript|javascript)\.$/u.test(normalized)) {
    return "language-default";
  }
  if (/^always use (?:strict mode|semicolons|tabs|spaces)\.$/u.test(normalized)) {
    return "code-style";
  }
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
