import { coercePositiveInteger } from "./numeric-coercion.js";

export type MemoryRetrievalMode = "lexical";
export type MemoryIndexBackfillOnStartup = "off" | "bounded" | "full";

export type MemoryRetrievalConfig = {
  enabled: boolean;
  mode: MemoryRetrievalMode;
  maxResults: number;
  maxChars: number;
};

export type MemoryIndexConfig = {
  enabled: boolean;
  backfillOnStartup: MemoryIndexBackfillOnStartup;
  reindexOnStartup: boolean;
  vacuumIntervalDays: number;
};

export type MemoryConfig = {
  retrieval: MemoryRetrievalConfig;
  index: MemoryIndexConfig;
};

export type MemoryConfigInput = {
  retrieval?: Partial<MemoryRetrievalConfig>;
  index?: Partial<MemoryIndexConfig>;
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  retrieval: {
    enabled: true,
    mode: "lexical",
    maxResults: 10,
    maxChars: 4_000
  },
  index: {
    enabled: true,
    backfillOnStartup: "bounded",
    reindexOnStartup: false,
    vacuumIntervalDays: 7
  }
};

const MEMORY_RETRIEVAL_MAX_RESULTS_CAP = 50;
const MEMORY_RETRIEVAL_MAX_CHARS_CAP = 20_000;
const MEMORY_INDEX_VACUUM_INTERVAL_DAYS_CAP = 365;
const MEMORY_INDEX_BACKFILL_VALUES: readonly MemoryIndexBackfillOnStartup[] = ["off", "bounded", "full"];

export function normalizeMemoryConfig(value: MemoryConfigInput | undefined): MemoryConfig {
  return {
    retrieval: normalizeMemoryRetrievalConfig(value?.retrieval),
    index: normalizeMemoryIndexConfig(value?.index)
  };
}

function normalizeMemoryRetrievalConfig(value: Partial<MemoryRetrievalConfig> | undefined): MemoryRetrievalConfig {
  return {
    enabled: value?.enabled === undefined ? DEFAULT_MEMORY_CONFIG.retrieval.enabled : value.enabled === true,
    mode: normalizeMemoryRetrievalMode(value?.mode),
    maxResults: coercePositiveInteger(value?.maxResults, {
      default: DEFAULT_MEMORY_CONFIG.retrieval.maxResults,
      max: MEMORY_RETRIEVAL_MAX_RESULTS_CAP
    }),
    maxChars: coercePositiveInteger(value?.maxChars, {
      default: DEFAULT_MEMORY_CONFIG.retrieval.maxChars,
      max: MEMORY_RETRIEVAL_MAX_CHARS_CAP
    })
  };
}

function normalizeMemoryIndexConfig(value: Partial<MemoryIndexConfig> | undefined): MemoryIndexConfig {
  return {
    enabled: value?.enabled === undefined ? DEFAULT_MEMORY_CONFIG.index.enabled : value.enabled === true,
    backfillOnStartup: normalizeMemoryIndexBackfill(value?.backfillOnStartup),
    reindexOnStartup: value?.reindexOnStartup === true,
    vacuumIntervalDays: coercePositiveInteger(value?.vacuumIntervalDays, {
      default: DEFAULT_MEMORY_CONFIG.index.vacuumIntervalDays,
      max: MEMORY_INDEX_VACUUM_INTERVAL_DAYS_CAP
    })
  };
}

function normalizeMemoryRetrievalMode(value: unknown): MemoryRetrievalMode {
  if (value === undefined) {
    return DEFAULT_MEMORY_CONFIG.retrieval.mode;
  }
  if (value === "lexical") {
    return value;
  }
  throw new Error("memory.retrieval.mode must be lexical");
}

function normalizeMemoryIndexBackfill(value: unknown): MemoryIndexBackfillOnStartup {
  if (value === undefined) {
    return DEFAULT_MEMORY_CONFIG.index.backfillOnStartup;
  }
  if (typeof value === "string" && (MEMORY_INDEX_BACKFILL_VALUES as readonly string[]).includes(value)) {
    return value as MemoryIndexBackfillOnStartup;
  }
  throw new Error("memory.index.backfillOnStartup must be off, bounded, or full");
}
