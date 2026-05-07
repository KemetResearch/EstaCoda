import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeAdapterRuntimeState,
  readAdapterRuntimeState,
  isRuntimeStateFresh,
  isRuntimeStatePidMatch,
  RUNTIME_STATE_STALE_MS,
} from "./adapter-runtime-state.js";
import type { PersistedRuntimeState } from "./adapter-runtime-state.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-runtime-state-test-"));
}

function fakeState(overrides?: Partial<PersistedRuntimeState>): PersistedRuntimeState {
  return {
    supervisorPid: process.pid,
    supervisorStartedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    adapters: [],
    ...overrides,
  };
}

describe("adapter-runtime-state persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("write then read roundtrip", async () => {
    const state = fakeState({
      adapters: [
        {
          kind: "telegram",
          state: "healthy",
          pollsTotal: 3,
          pollsFailed: 0,
          pollMessagesProcessed: 7,
        },
      ],
    });
    await writeAdapterRuntimeState(tmpDir, state);
    const read = await readAdapterRuntimeState(tmpDir);
    expect(read).toEqual(state);
  });

  it("missing file returns undefined", async () => {
    const read = await readAdapterRuntimeState(tmpDir);
    expect(read).toBeUndefined();
  });

  it("corrupt file returns undefined", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = join(tmpDir, ".estacoda", "gateway", "adapter-runtime-state.json");
    await mkdir(join(tmpDir, ".estacoda", "gateway"), { recursive: true });
    await writeFile(path, "not json");
    const read = await readAdapterRuntimeState(tmpDir);
    expect(read).toBeUndefined();
  });

  it("isFresh returns true for recent file", () => {
    const state = fakeState();
    expect(isRuntimeStateFresh(state)).toBe(true);
  });

  it("isFresh returns false for old file", () => {
    const state = fakeState({
      updatedAt: new Date(Date.now() - RUNTIME_STATE_STALE_MS - 1000).toISOString(),
    });
    expect(isRuntimeStateFresh(state)).toBe(false);
  });

  it("read rejects stale supervisorPid", () => {
    const state = fakeState({ supervisorPid: 12345 });
    expect(isRuntimeStatePidMatch(state, 99999)).toBe(false);
  });

  it("read accepts matching supervisorPid", () => {
    const state = fakeState({ supervisorPid: 12345 });
    expect(isRuntimeStatePidMatch(state, 12345)).toBe(true);
  });
});
