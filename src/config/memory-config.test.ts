import { describe, expect, it } from "vitest";
import { stableJsonHash } from "../runtime/runtime-fingerprint.js";
import { normalizeExternalMemoryConfig } from "./runtime-config.js";
import { DEFAULT_MEMORY_CONFIG, normalizeMemoryConfig } from "./memory-config.js";

describe("normalizeMemoryConfig", () => {
  it("normalizes defaults deterministically", () => {
    const first = normalizeMemoryConfig(undefined);
    const second = normalizeMemoryConfig({});

    expect(first).toEqual(DEFAULT_MEMORY_CONFIG);
    expect(second).toEqual(DEFAULT_MEMORY_CONFIG);
    expect(stableJsonHash(first)).toBe(stableJsonHash(second));
  });

  it("merges partial memory config with defaults", () => {
    expect(normalizeMemoryConfig({
      retrieval: { maxResults: 5 },
      index: { reindexOnStartup: true }
    })).toEqual({
      retrieval: {
        enabled: true,
        mode: "lexical",
        maxResults: 5,
        maxChars: 4_000
      },
      index: {
        enabled: true,
        backfillOnStartup: "bounded",
        reindexOnStartup: true,
        vacuumIntervalDays: 7
      }
    });
  });

  it("preserves disabled retrieval and index flags", () => {
    expect(normalizeMemoryConfig({
      retrieval: { enabled: false },
      index: { enabled: false }
    })).toMatchObject({
      retrieval: { enabled: false },
      index: { enabled: false }
    });
  });

  it("defaults retrieval mode to lexical and rejects invalid modes", () => {
    expect(normalizeMemoryConfig({ retrieval: {} }).retrieval.mode).toBe("lexical");
    expect(() => normalizeMemoryConfig({
      retrieval: { mode: "semantic" as never }
    })).toThrow("memory.retrieval.mode must be lexical");
  });

  it("accepts only supported backfillOnStartup values", () => {
    expect(normalizeMemoryConfig({ index: { backfillOnStartup: "off" } }).index.backfillOnStartup).toBe("off");
    expect(normalizeMemoryConfig({ index: { backfillOnStartup: "bounded" } }).index.backfillOnStartup).toBe("bounded");
    expect(normalizeMemoryConfig({ index: { backfillOnStartup: "full" } }).index.backfillOnStartup).toBe("full");
    expect(() => normalizeMemoryConfig({
      index: { backfillOnStartup: "later" as never }
    })).toThrow("memory.index.backfillOnStartup must be off, bounded, or full");
  });

  it("bounds and sanitizes numeric retrieval and index values", () => {
    expect(normalizeMemoryConfig({
      retrieval: {
        maxResults: "0" as never,
        maxChars: "999999" as never
      },
      index: {
        vacuumIntervalDays: Number.NaN as never
      }
    })).toMatchObject({
      retrieval: {
        maxResults: 1,
        maxChars: 20_000
      },
      index: {
        vacuumIntervalDays: 7
      }
    });

    expect(normalizeMemoryConfig({
      retrieval: {
        maxResults: "15" as never,
        maxChars: "8000" as never
      },
      index: {
        vacuumIntervalDays: "400" as never
      }
    })).toMatchObject({
      retrieval: {
        maxResults: 15,
        maxChars: 8_000
      },
      index: {
        vacuumIntervalDays: 365
      }
    });
  });

  it("memory retrieval hash changes for retrieval and index changes", () => {
    const base = normalizeMemoryConfig(undefined);
    const retrievalChanged = normalizeMemoryConfig({
      retrieval: { maxResults: base.retrieval.maxResults + 1 }
    });
    const indexChanged = normalizeMemoryConfig({
      index: { backfillOnStartup: "full" }
    });

    expect(stableJsonHash(retrievalChanged)).not.toBe(stableJsonHash(base));
    expect(stableJsonHash(indexChanged)).not.toBe(stableJsonHash(base));
  });

  it("external memory config hash does not change because of local memory retrieval config", () => {
    const external = normalizeExternalMemoryConfig(undefined);
    normalizeMemoryConfig({
      retrieval: { enabled: false, maxResults: 20 },
      index: { enabled: false, backfillOnStartup: "off" }
    });

    expect(stableJsonHash(normalizeExternalMemoryConfig(undefined))).toBe(stableJsonHash(external));
  });
});
