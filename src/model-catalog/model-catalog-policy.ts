import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelProfile, ProviderId } from "../contracts/provider.js";
import {
  normalizeProviderIdForEstaCoda,
  type ModelInfo,
  type ModelModality
} from "./models-dev-registry.js";

export type ModelLifecycle = "available" | "deprecated" | "retired";

export type ModelUsageClass =
  | "primary-chat"
  | "image"
  | "embedding"
  | "audio"
  | "deep-research"
  | "moderation"
  | "other";

export type ModelCatalogPolicy = {
  lifecycle: ModelLifecycle;
  usageClass: ModelUsageClass;
  note?: string;
};

export type ModelCatalogOverride = {
  provider: ProviderId;
  model: string;
} & ModelCatalogPolicy;

export type ModelCatalogOverrideRegistry = {
  version: 1;
  models: ModelCatalogOverride[];
};

export type ModelLifecycleWarningContext = "primary-selection" | "report" | "status";

export type ModelCatalogClassificationInput = {
  provider: ProviderId | string;
  model: string;
  profile?: ModelProfile;
  modelInfo?: Pick<ModelInfo, "id" | "name" | "family" | "providerId" | "inputModalities" | "outputModalities" | "status">;
  overrides?: ModelCatalogOverrideRegistry;
};

const MODEL_LIFECYCLES = new Set<ModelLifecycle>(["available", "deprecated", "retired"]);
const MODEL_USAGE_CLASSES = new Set<ModelUsageClass>([
  "primary-chat",
  "image",
  "embedding",
  "audio",
  "deep-research",
  "moderation",
  "other"
]);
const TOP_LEVEL_KEYS = new Set(["version", "models"]);
const MODEL_ENTRY_KEYS = new Set(["provider", "model", "lifecycle", "usageClass", "note"]);
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SECRET_LIKE_PATTERN = /\b(?:api[_-]?key|secret|token|bearer|password)\b|(?:sk|ghp|gho|github_pat)_[a-z0-9_=-]{8,}/i;

export function parseModelCatalogOverrides(data: unknown): ModelCatalogOverrideRegistry {
  if (!isRecord(data)) {
    throw new Error("Model catalog overrides must be a JSON object.");
  }

  assertAllowedKeys(data, TOP_LEVEL_KEYS, "model catalog overrides");

  if (data.version !== 1) {
    throw new Error("Model catalog overrides version must be 1.");
  }

  if (!Array.isArray(data.models)) {
    throw new Error("Model catalog overrides models must be an array.");
  }

  const models = data.models.map((entry, index) => parseOverrideEntry(entry, index));

  return {
    version: 1,
    models
  };
}

export async function loadBundledModelCatalogOverrides(options: {
  path?: string;
} = {}): Promise<ModelCatalogOverrideRegistry> {
  const path = options.path ?? defaultBundledOverridesPath();
  const raw = await readFile(path, "utf8");
  return parseModelCatalogOverrides(JSON.parse(raw) as unknown);
}

export function lookupModelCatalogOverride(
  registry: ModelCatalogOverrideRegistry | undefined,
  provider: ProviderId | string,
  model: string
): ModelCatalogPolicy | undefined {
  if (registry === undefined) {
    return undefined;
  }

  const canonicalProvider = normalizeProviderIdForEstaCoda(provider);
  const match = registry.models.find((entry) =>
    entry.provider === canonicalProvider && entry.model === model
  );

  if (match === undefined) {
    return undefined;
  }

  return policyFromOverride(match);
}

export function classifyModelForCatalog(input: ModelCatalogClassificationInput): ModelCatalogPolicy {
  const override = lookupModelCatalogOverride(input.overrides, input.provider, input.model);

  if (override !== undefined) {
    return override;
  }

  return {
    lifecycle: inferLifecycle(input),
    usageClass: inferUsageClass(input)
  };
}

export function buildModelLifecycleWarnings(input: {
  policy: ModelCatalogPolicy;
  context?: ModelLifecycleWarningContext;
}): string[] {
  const warnings: string[] = [];

  if (input.policy.lifecycle === "retired") {
    warnings.push("Model is retired.");
  } else if (input.policy.lifecycle === "deprecated") {
    warnings.push("Model is deprecated.");
  }

  if (input.context === "primary-selection" && input.policy.usageClass !== "primary-chat") {
    warnings.push("Model is not a primary chat model.");
  }

  return warnings;
}

function parseOverrideEntry(entry: unknown, index: number): ModelCatalogOverride {
  if (!isRecord(entry)) {
    throw new Error(`Model catalog override at index ${index} must be an object.`);
  }

  assertAllowedKeys(entry, MODEL_ENTRY_KEYS, `model catalog override at index ${index}`);

  const provider = parseProvider(entry.provider, index);
  const model = parseNonEmptyString(entry.model, `model catalog override at index ${index} model`);
  const lifecycle = parseLifecycle(entry.lifecycle, index);
  const usageClass = parseUsageClass(entry.usageClass, index);
  const note = parseNote(entry.note, index);

  return note === undefined
    ? { provider, model, lifecycle, usageClass }
    : { provider, model, lifecycle, usageClass, note };
}

function parseProvider(value: unknown, index: number): ProviderId {
  const provider = parseNonEmptyString(value, `model catalog override at index ${index} provider`);
  const normalized = normalizeProviderIdForEstaCoda(provider);

  if (provider !== normalized) {
    throw new Error(`Model catalog override at index ${index} provider must be canonical.`);
  }

  if (!PROVIDER_ID_PATTERN.test(provider)) {
    throw new Error(`Model catalog override at index ${index} provider is invalid.`);
  }

  return provider as ProviderId;
}

function parseLifecycle(value: unknown, index: number): ModelLifecycle {
  if (typeof value !== "string" || !MODEL_LIFECYCLES.has(value as ModelLifecycle)) {
    throw new Error(`Model catalog override at index ${index} lifecycle is invalid.`);
  }

  return value as ModelLifecycle;
}

function parseUsageClass(value: unknown, index: number): ModelUsageClass {
  if (typeof value !== "string" || !MODEL_USAGE_CLASSES.has(value as ModelUsageClass)) {
    throw new Error(`Model catalog override at index ${index} usageClass is invalid.`);
  }

  return value as ModelUsageClass;
}

function parseNote(value: unknown, index: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const note = parseNonEmptyString(value, `model catalog override at index ${index} note`);

  if (SECRET_LIKE_PATTERN.test(note)) {
    throw new Error(`Model catalog override at index ${index} note contains secret-like material.`);
  }

  return note;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  return trimmed;
}

function assertAllowedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} contains unknown key '${key}'.`);
    }
  }
}

function policyFromOverride(override: ModelCatalogOverride): ModelCatalogPolicy {
  return override.note === undefined
    ? {
        lifecycle: override.lifecycle,
        usageClass: override.usageClass
      }
    : {
        lifecycle: override.lifecycle,
        usageClass: override.usageClass,
        note: override.note
      };
}

function inferLifecycle(input: ModelCatalogClassificationInput): ModelLifecycle {
  if (input.profile?.status === "deprecated" || input.modelInfo?.status === "deprecated") {
    return "deprecated";
  }

  return "available";
}

function inferUsageClass(input: ModelCatalogClassificationInput): ModelUsageClass {
  const modelText = [
    input.model,
    input.profile?.id,
    input.modelInfo?.id,
    input.modelInfo?.name,
    input.modelInfo?.family
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const inputModalities = input.modelInfo?.inputModalities ?? [];
  const outputModalities = input.modelInfo?.outputModalities ?? [];

  if (isEmbeddingModel(modelText)) {
    return "embedding";
  }

  if (isImageModel(modelText, outputModalities)) {
    return "image";
  }

  if (isAudioModel(modelText, inputModalities, outputModalities)) {
    return "audio";
  }

  if (isModerationModel(modelText)) {
    return "moderation";
  }

  if (isDeepResearchModel(modelText)) {
    return "deep-research";
  }

  if (isTextCapable(input, modelText, outputModalities)) {
    return "primary-chat";
  }

  return "other";
}

function isEmbeddingModel(modelText: string): boolean {
  return /\bembed(?:ding)?s?\b|text-embedding|embedding-|ada-002/.test(modelText);
}

function isImageModel(modelText: string, outputModalities: readonly ModelModality[]): boolean {
  return outputModalities.includes("image") ||
    /\b(?:image|dall-e|imagen|flux|sdxl|stable-diffusion)\b|(?:^|\s)gpt-image-|chatgpt-image/.test(modelText);
}

function isAudioModel(
  modelText: string,
  inputModalities: readonly ModelModality[],
  outputModalities: readonly ModelModality[]
): boolean {
  return outputModalities.includes("audio") ||
    (!outputModalities.includes("text") && inputModalities.includes("audio")) ||
    /\b(?:tts|stt|whisper|transcrib|speech|audio|voice)\b/.test(modelText);
}

function isModerationModel(modelText: string): boolean {
  return /\bmoderation\b|omni-moderation/.test(modelText);
}

function isDeepResearchModel(modelText: string): boolean {
  return /\bdeep-research\b/.test(modelText);
}

function isTextCapable(
  input: ModelCatalogClassificationInput,
  modelText: string,
  outputModalities: readonly ModelModality[]
): boolean {
  if (outputModalities.includes("text")) {
    return true;
  }

  if (input.profile !== undefined) {
    return input.profile.supportsTools ||
      input.profile.supportsStructuredOutput ||
      input.profile.supportsReasoning === true ||
      input.profile.supportsVision ||
      isKnownChatModelName(modelText);
  }

  return isKnownChatModelName(modelText);
}

function isKnownChatModelName(modelText: string): boolean {
  return /\b(?:gpt|claude|gemini|deepseek|kimi|glm|hermes|qwen|llama|mistral|mixtral|sonnet|opus)\b/.test(modelText);
}

function defaultBundledOverridesPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/model-catalog-overrides.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
