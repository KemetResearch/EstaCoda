import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProfileStateHome } from "../config/profile-home.js";
import {
  MEMORY_INDEX_SCHEMA_VERSION,
  MEMORY_INDEX_SQLITE_FILENAME,
  MemoryIndexStore,
  resolveMemoryIndexStorePath
} from "./memory-index-store.js";

describe("MemoryIndexStore", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "estacoda-memory-index-store-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("creates profile-state memory-index.sqlite", () => {
    const paths = resolveProfileStateHome({ homeDir, profileId: "alpha" });
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });

    try {
      expect(store.path).toBe(join(paths.profileRoot, MEMORY_INDEX_SQLITE_FILENAME));
      expect(existsSync(store.path)).toBe(true);
    } finally {
      store.dispose();
    }
  });

  it("resolves the store path to profile-state memory-index.sqlite", () => {
    expect(resolveMemoryIndexStorePath({ homeDir, profileId: "beta" })).toBe(
      join(homeDir, ".estacoda", "profiles", "beta", MEMORY_INDEX_SQLITE_FILENAME)
    );
  });

  it("migrates schema idempotently", () => {
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });
    const dbPath = store.path;

    try {
      expect(store.inspectSchema().schemaVersion).toBe(MEMORY_INDEX_SCHEMA_VERSION);
    } finally {
      store.dispose();
    }

    const reopened = new MemoryIndexStore({ path: dbPath });
    try {
      expect(reopened.inspectSchema().schemaVersion).toBe(MEMORY_INDEX_SCHEMA_VERSION);
      expect(reopened.inspectSchema().entryCount).toBe(0);
    } finally {
      reopened.dispose();
    }
  });

  it("can be deleted and recreated while stopped", async () => {
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });
    const dbPath = store.path;
    store.dispose();

    await rm(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    const recreated = new MemoryIndexStore({ path: dbPath });
    try {
      expect(existsSync(dbPath)).toBe(true);
      expect(recreated.inspectSchema().schemaVersion).toBe(MEMORY_INDEX_SCHEMA_VERSION);
    } finally {
      recreated.dispose();
    }
  });

  it("creates memory_index and memory_index_fts schema objects", () => {
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });

    try {
      const schema = store.inspectSchema();
      expect(schema.tables).toContain("memory_index");
      expect(schema.tables).toContain("memory_index_fts");
      expect(schema.triggers).toEqual(
        expect.arrayContaining([
          "memory_index_ai",
          "memory_index_ad",
          "memory_index_au"
        ])
      );
    } finally {
      store.dispose();
    }
  });

  it("includes protected_class in memory_index", () => {
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });

    try {
      expect(store.inspectSchema().memoryIndexColumns).toContain("protected_class");
    } finally {
      store.dispose();
    }
  });

  it("creates retrieval and staleness indexes", () => {
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });

    try {
      expect(store.inspectSchema().indexes).toEqual(
        expect.arrayContaining([
          "idx_memory_index_profile",
          "idx_memory_index_source",
          "idx_memory_index_content_hash",
          "idx_memory_index_protected_class"
        ])
      );
    } finally {
      store.dispose();
    }
  });

  it("does not backfill memory files during migration", async () => {
    const paths = resolveProfileStateHome({ homeDir, profileId: "alpha" });
    await mkdir(paths.profileRoot, { recursive: true });
    await writeFile(paths.userMdPath, "user memory fixture\n", "utf8");
    await writeFile(paths.soulMdPath, "protected fixture\n", "utf8");
    await writeFile(paths.memoryMdPath, "general memory fixture\n", "utf8");

    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });
    try {
      expect(store.inspectSchema().entryCount).toBe(0);
    } finally {
      store.dispose();
    }
  });

  it("dispose closes the database handle", async () => {
    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });
    const dbPath = store.path;

    store.dispose();

    await rm(dbPath);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("deleting the index database does not touch authoritative memory files", async () => {
    const paths = resolveProfileStateHome({ homeDir, profileId: "alpha" });
    await mkdir(paths.profileRoot, { recursive: true });
    await writeFile(paths.userMdPath, "authoritative user memory\n", "utf8");
    await writeFile(paths.soulMdPath, "authoritative soul memory\n", "utf8");
    await writeFile(paths.memoryMdPath, "authoritative general memory\n", "utf8");

    const store = new MemoryIndexStore({ homeDir, profileId: "alpha" });
    const dbPath = store.path;
    store.dispose();

    await rm(dbPath);

    await expect(readFile(paths.userMdPath, "utf8")).resolves.toBe("authoritative user memory\n");
    await expect(readFile(paths.soulMdPath, "utf8")).resolves.toBe("authoritative soul memory\n");
    await expect(readFile(paths.memoryMdPath, "utf8")).resolves.toBe("authoritative general memory\n");
  });
});
