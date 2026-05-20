import type { LoadedRuntimeConfig } from "./runtime-config.js";
import type { SessionDB, SessionEvent, SessionHistoryCompressedEvent } from "../contracts/session.js";
import type { ResolvedAuxiliaryRoute } from "../contracts/provider.js";
import { resolveAuxiliaryModelRoute } from "../providers/auxiliary-model-resolver.js";
import { reconstructSessionCompressionState } from "../session/session-compression-state.js";
import { truncate } from "../utils/formatting.js";
import { redactSensitiveText } from "../utils/redaction.js";

const MAX_STATUS_FAILURE_CHARS = 240;
const MAX_STATUS_DIAGNOSTIC_CHARS = 240;

export type CompressionStatusReport = {
  config: {
    enabled: boolean;
    effectiveEnabled: boolean;
    experimental: boolean;
    active: boolean;
    threshold: number;
    targetRatio: number;
    protectFirstN: number;
    protectLastN: number;
    summaryModelContextLength?: number;
  };
  auxiliaryRoute: {
    configured: boolean;
    resolved: boolean;
    source?: ResolvedAuxiliaryRoute["source"];
    provider?: string;
    model?: string;
    timeoutMs?: number;
    fallbackToMain: boolean;
    diagnostics: string[];
  };
  session?: {
    available: boolean;
    warning?: string;
    state?: {
      compressionCount: number;
      lastCompressedAt?: string;
      lastCompressedThroughMessageId?: string;
      lastPromptTokensEstimated?: number;
      lastActualPromptTokens?: number;
      lastCompressionSavingsPct?: number;
      ineffectiveCompressionCount: number;
      recentSavingsRatios?: number[];
      summaryFailureCooldownUntil?: string;
      latestFallbackReason?: string;
      warningCount: number;
    };
    latestEvent?: {
      trigger?: string;
      mode: "semantic" | "deterministic" | "none";
      fallbackUsed?: boolean;
      fallbackReason?: string;
      modelUsed?: string;
      summaryLengthTokens?: number;
      sourceMessageCount?: number;
      protectedMessageCount?: number;
      droppedMessageCount?: number;
      warningCount: number;
      failure?: {
        code: string;
        message: string;
      };
      auxModelFailure?: {
        code: string;
        message: string;
      };
      mainRetryFailure?: {
        code: string;
        message: string;
      };
    };
  };
};

type CompressionSessionStatus = NonNullable<CompressionStatusReport["session"]>;

export async function buildCompressionStatusReport(input: {
  loaded: LoadedRuntimeConfig;
  sessionDb?: Pick<SessionDB, "listEvents">;
  sessionId?: string;
}): Promise<CompressionStatusReport> {
  const config = input.loaded.compression;
  const rawCompressionConfig = input.loaded.config.compression;
  const auxiliaryRoute = await compressionAuxiliaryRouteStatus(input.loaded);
  const report: CompressionStatusReport = {
    config: {
      enabled: rawCompressionConfig?.enabled === true,
      effectiveEnabled: config.enabled,
      experimental: config.experimental === true,
      active: config.enabled === true && config.experimental === true,
      threshold: config.threshold,
      targetRatio: config.targetRatio,
      protectFirstN: config.protectFirstN,
      protectLastN: config.protectLastN,
      ...(config.summaryModelContextLength === undefined ? {} : { summaryModelContextLength: config.summaryModelContextLength })
    },
    auxiliaryRoute
  };

  if (input.sessionDb === undefined || input.sessionId === undefined) {
    return report;
  }

  try {
    const events = await input.sessionDb.listEvents(input.sessionId);
    report.session = buildSessionStatus(events);
  } catch (error) {
    report.session = {
      available: false,
      warning: truncate(redactSensitiveText(error instanceof Error ? error.message : String(error)), MAX_STATUS_FAILURE_CHARS)
    };
  }

  return report;
}

export function renderCompressionStatusReport(report: CompressionStatusReport): string {
  const lines = [
    "Semantic compression",
    `Enabled: ${report.config.enabled ? "yes" : "no"}`,
    `Effective enabled: ${report.config.effectiveEnabled ? "yes" : "no"}`,
    `Experimental: ${report.config.experimental ? "yes" : "no"}`,
    `Active: ${report.config.active ? "yes" : "no"}`,
    `Threshold: ${report.config.threshold}`,
    `Target ratio: ${report.config.targetRatio}`,
    `Protect first: ${report.config.protectFirstN}`,
    `Protect last: ${report.config.protectLastN}`,
    report.config.summaryModelContextLength === undefined
      ? undefined
      : `Summary model context length: ${report.config.summaryModelContextLength}`,
    "",
    "Auxiliary compression route",
    `Configured: ${report.auxiliaryRoute.configured ? "yes" : "no"}`,
    `Resolved: ${report.auxiliaryRoute.resolved ? "yes" : "no"}`,
    report.auxiliaryRoute.source === undefined ? undefined : `Source: ${report.auxiliaryRoute.source}`,
    report.auxiliaryRoute.provider === undefined ? undefined : `Provider: ${report.auxiliaryRoute.provider}`,
    report.auxiliaryRoute.model === undefined ? undefined : `Model: ${report.auxiliaryRoute.model}`,
    report.auxiliaryRoute.timeoutMs === undefined ? undefined : `Timeout ms: ${report.auxiliaryRoute.timeoutMs}`,
    `Fallback to main: ${report.auxiliaryRoute.fallbackToMain ? "yes" : "no"}`,
    report.auxiliaryRoute.diagnostics.length === 0
      ? undefined
      : `Diagnostics: ${report.auxiliaryRoute.diagnostics.join("; ")}`
  ];

  if (report.session === undefined) {
    lines.push("", "Session compression state: unavailable");
  } else if (!report.session.available) {
    lines.push("", `Session compression state: unavailable${report.session.warning === undefined ? "" : ` (${report.session.warning})`}`);
  } else {
    lines.push(
      "",
      "Session compression state",
      `Compression count: ${report.session.state?.compressionCount ?? 0}`,
      report.session.state?.lastCompressedAt === undefined ? undefined : `Last compressed at: ${report.session.state.lastCompressedAt}`,
      report.session.state?.lastCompressedThroughMessageId === undefined
        ? undefined
        : `Last compressed through message: ${report.session.state.lastCompressedThroughMessageId}`,
      report.session.state?.lastPromptTokensEstimated === undefined
        ? undefined
        : `Last prompt tokens estimated: ${report.session.state.lastPromptTokensEstimated}`,
      report.session.state?.lastActualPromptTokens === undefined
        ? undefined
        : `Last actual prompt tokens: ${report.session.state.lastActualPromptTokens}`,
      report.session.state?.lastCompressionSavingsPct === undefined
        ? undefined
        : `Last savings pct: ${report.session.state.lastCompressionSavingsPct}`,
      `Ineffective compression count: ${report.session.state?.ineffectiveCompressionCount ?? 0}`,
      report.session.state?.summaryFailureCooldownUntil === undefined
        ? undefined
        : `Cooldown until: ${report.session.state.summaryFailureCooldownUntil}`,
      report.session.latestEvent === undefined
        ? "Latest event: none"
        : `Latest event: ${report.session.latestEvent.trigger ?? "unknown"} / ${report.session.latestEvent.mode}`
    );
  }

  return lines.filter((line) => line !== undefined).join("\n");
}

async function compressionAuxiliaryRouteStatus(loaded: LoadedRuntimeConfig): Promise<CompressionStatusReport["auxiliaryRoute"]> {
  const configured = loaded.config.auxiliaryModels?.compression !== undefined;
  try {
    const providerModels = await loaded.providerRegistry.listModels();
    const resolved = resolveAuxiliaryModelRoute("compression", loaded.auxiliaryModels, {
      mainRoute: loaded.primaryModelRoute,
      providerRegistry: loaded.providerRegistry,
      providerModels
    });
    return {
      configured,
      resolved: resolved.route !== undefined,
      source: resolved.source,
      ...(resolved.route === undefined ? {} : {
        provider: resolved.route.provider,
        model: resolved.route.id
      }),
      ...(resolved.timeoutMs === undefined ? {} : { timeoutMs: resolved.timeoutMs }),
      fallbackToMain: resolved.fallbackToMain,
      diagnostics: sanitizeDiagnostics(resolved.diagnostics)
    };
  } catch (error) {
    return {
      configured,
      resolved: false,
      fallbackToMain: false,
      diagnostics: [truncate(redactSensitiveText(error instanceof Error ? error.message : String(error)), MAX_STATUS_DIAGNOSTIC_CHARS)]
    };
  }
}

function buildSessionStatus(events: readonly unknown[]): CompressionStatusReport["session"] {
  const state = reconstructSessionCompressionState(events);
  const latestEvent = latestCompressionEvent(events);
  return {
    available: true,
    state: {
      compressionCount: state.compressionCount,
      lastCompressedAt: state.lastCompressedAt,
      lastCompressedThroughMessageId: state.lastCompressedThroughMessageId,
      lastPromptTokensEstimated: state.lastPromptTokensEstimated,
      lastActualPromptTokens: state.lastActualPromptTokens,
      lastCompressionSavingsPct: state.lastCompressionSavingsPct,
      ineffectiveCompressionCount: state.ineffectiveCompressionCount,
      recentSavingsRatios: state.recentSavingsRatios,
      summaryFailureCooldownUntil: state.summaryFailureCooldownUntil,
      latestFallbackReason: state.fallbackReason,
      warningCount: state.warnings.length
    },
    latestEvent
  };
}

function latestCompressionEvent(events: readonly unknown[]): CompressionSessionStatus["latestEvent"] {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!isRecord(event) || event.kind !== "session-history-compressed") {
      continue;
    }
    const compressed = event as Partial<SessionHistoryCompressedEvent>;
    return {
      trigger: typeof compressed.trigger === "string" ? compressed.trigger : undefined,
      mode: compressed.fallbackReason?.includes("deterministic") === true ? "deterministic" : "semantic",
      fallbackUsed: compressed.fallbackUsed,
      fallbackReason: typeof compressed.fallbackReason === "string"
        ? truncate(redactSensitiveText(compressed.fallbackReason), MAX_STATUS_FAILURE_CHARS)
        : undefined,
      modelUsed: typeof compressed.modelUsed === "string" ? compressed.modelUsed : compressed.model,
      summaryLengthTokens: typeof compressed.summaryLengthTokens === "number" && Number.isFinite(compressed.summaryLengthTokens)
        ? Math.max(0, Math.floor(compressed.summaryLengthTokens))
        : undefined,
      sourceMessageCount: typeof compressed.sourceMessageCount === "number" && Number.isFinite(compressed.sourceMessageCount)
        ? Math.max(0, Math.floor(compressed.sourceMessageCount))
        : undefined,
      protectedMessageCount: typeof compressed.protectedMessageCount === "number" && Number.isFinite(compressed.protectedMessageCount)
        ? Math.max(0, Math.floor(compressed.protectedMessageCount))
        : undefined,
      droppedMessageCount: typeof compressed.droppedMessageCount === "number" && Number.isFinite(compressed.droppedMessageCount)
        ? Math.max(0, Math.floor(compressed.droppedMessageCount))
        : undefined,
      warningCount: Array.isArray(compressed.warnings) ? compressed.warnings.length : 0,
      failure: sanitizeFailure(compressed.failure),
      auxModelFailure: sanitizeFailure(compressed.auxModelFailure),
      mainRetryFailure: sanitizeFailure(compressed.mainRetryFailure)
    };
  }
  return undefined;
}

function sanitizeFailure(value: unknown): { code: string; message: string } | undefined {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    return undefined;
  }
  return {
    code: truncate(redactSensitiveText(value.code), 80),
    message: truncate(redactSensitiveText(value.message), MAX_STATUS_FAILURE_CHARS)
  };
}

function sanitizeDiagnostics(diagnostics: readonly string[]): string[] {
  return diagnostics
    .map((diagnostic) => truncate(redactSensitiveText(diagnostic), MAX_STATUS_DIAGNOSTIC_CHARS))
    .slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
