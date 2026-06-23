import type { ToolsetName } from "../contracts/tool.js";

export const MAX_SKILL_SCAN_DEPTH = 8;
export const MAX_SKILL_FILES = 500;
export const MAX_SKILL_MD_CHARS = 20_000;
export const MAX_SKILL_MD_BYTES = 128_000;
export const SKILL_ROOT_INLINE_MAX_CHARS = 8_000;
export const SKILL_PROMPT_BLOCK_MAX_CHARS = 12_000;
export const SKILL_CONTRACT_MAX_CHARS = 4_000;
export const SKILL_READ_MAX_CHARS = 20_000;
export const SKILL_SEARCH_MAX_RESULTS = 10;
export const SKILL_SEARCH_DEFAULT_RESULTS = 5;
export const SKILL_SEARCH_EXCERPT_MAX_CHARS = 1_200;
export const MAX_SKILL_RESOURCE_FILES = 100;
export const MAX_SKILL_RESOURCE_CHARS = 20_000;
export const MAX_SKILL_RESOURCE_BYTES = 128_000;
export const MAX_SKILL_RESOURCE_SCAN_DEPTH = 6;

export const KNOWN_TOOLSETS = [
  "core",
  "files",
  "shell-readonly",
  "shell-write",
  "web",
  "browser",
  "telegram",
  "media",
  "coding",
  "research",
  "memory",
  "mcp",
  "dangerous"
] as const satisfies readonly ToolsetName[];

const KNOWN_TOOLSET_VALUES = new Set<string>(KNOWN_TOOLSETS);

export function isKnownToolsetName(value: string): value is ToolsetName {
  return KNOWN_TOOLSET_VALUES.has(value);
}

export function assertKnownToolsetName(value: string, field: string): asserts value is ToolsetName {
  if (!isKnownToolsetName(value)) {
    throw new Error(`Skill field ${field} contains unknown toolset: ${value}`);
  }
}
