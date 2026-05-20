import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../contracts/session.js";
import {
  INITIAL_SESSION_COMPRESSION_STATE,
  reconstructSessionCompressionState
} from "./session-compression-state.js";

describe("session compression events and state", () => {
  it("serializes and deserializes session-history-compressed without envelope metadata", () => {
    const event: SessionEvent = {
      kind: "session-history-compressed",
      trigger: "manual",
      source: {
        startMessageId: "m1",
        endMessageId: "m8",
        messageCount: 8,
        estimatedTokens: 2400
      },
      sourceMessageCount: 12,
      protectedFirstN: 3,
      protectedLastN: 20,
      protectedSpans: [{ startMessageId: "m1", endMessageId: "m3", messageCount: 3 }],
      protectedMessageCount: 4,
      summaryFormatVersion: "session-summary.v1",
      summaryChars: 1200,
      summaryEstimatedTokens: 300,
      summaryLengthTokens: 300,
      droppedMessageCount: 7,
      estimatedSavingsTokens: 2100,
      estimatedSavingsRatio: 0.72,
      fallbackUsed: false,
      model: "openai/gpt-test",
      modelUsed: "openai/gpt-test",
      warnings: ["bounded"]
    };

    const parsed = JSON.parse(JSON.stringify(event)) as SessionEvent;

    expect(parsed).toEqual(event);
    expect(parsed).not.toHaveProperty("sessionId");
    expect(parsed).not.toHaveProperty("createdAt");
    expect(parsed).not.toHaveProperty("timestamp");
  });

  it("serializes and deserializes session-compression-state without envelope metadata", () => {
    const event: SessionEvent = {
      kind: "session-compression-state",
      state: {
        status: "compressed",
        trigger: "auto",
        compressionCount: 3,
        lastCompressedAt: "2030-01-01T00:00:00.000Z",
        previousSummary: "bounded summary",
        lastCompressedThroughMessageId: "m8",
        lastPromptTokensEstimated: 4000,
        lastActualPromptTokens: 4200,
        protectedFirstN: 3,
        protectedLastN: 20,
        protectedSpans: [],
        sourceMessageCount: 12,
        protectedMessageCount: 4,
        summaryFormatVersion: "session-summary.v1",
        summaryChars: 500,
        summaryEstimatedTokens: 125,
        summaryLengthTokens: 125,
        droppedMessageCount: 7,
        lastCompressionSavingsPct: 8.5,
        ineffectiveCompressionCount: 2,
        recentSavingsRatios: [0.12, 0.085],
        summaryFailureCooldownUntil: "2030-01-01T00:01:00.000Z",
        fallbackUsed: true,
        fallbackReason: "failed",
        modelUsed: "openai/gpt-test",
        auxModelFailure: {
          code: "network",
          message: "auxiliary failed",
          recoverable: true
        },
        mainRetryFailure: {
          code: "timeout",
          message: "main retry timed out",
          recoverable: true
        },
        warnings: ["fallback"]
      }
    };

    const parsed = JSON.parse(JSON.stringify(event)) as SessionEvent;

    expect(parsed).toEqual(event);
    expect(parsed).not.toHaveProperty("sessionId");
    expect(parsed).not.toHaveProperty("createdAt");
    expect(parsed).not.toHaveProperty("timestamp");
  });

  it("returns initial state when no state event exists", () => {
    expect(reconstructSessionCompressionState([])).toEqual(INITIAL_SESSION_COMPRESSION_STATE);
  });

  it("uses the latest state event and defaults missing fields safely", () => {
    const state = reconstructSessionCompressionState([
      {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          protectedFirstN: 3,
          protectedLastN: 10,
          fallbackUsed: true,
          warnings: ["old"]
        }
      },
      {
        kind: "session-compression-state",
        state: {
          status: "failed",
          trigger: "hygiene",
          failure: {
            code: "provider-failed",
            message: "provider unavailable"
          }
        }
      }
    ]);

    expect(state).toEqual({
      status: "failed",
      trigger: "hygiene",
      compressionCount: 0,
      lastCompressedAt: undefined,
      previousSummary: undefined,
      lastCompressedThroughMessageId: undefined,
      lastPromptTokensEstimated: undefined,
      lastActualPromptTokens: undefined,
      source: undefined,
      protectedFirstN: 0,
      protectedLastN: 0,
      protectedSpans: [],
      sourceMessageCount: undefined,
      protectedMessageCount: undefined,
      summaryFormatVersion: undefined,
      summaryMessageId: undefined,
      summaryChars: undefined,
      summaryEstimatedTokens: undefined,
      summaryLengthTokens: undefined,
      droppedMessageCount: undefined,
      estimatedSavingsTokens: undefined,
      lastCompressionSavingsPct: undefined,
      ineffectiveCompressionCount: 0,
      recentSavingsRatios: undefined,
      summaryFailureCooldownUntil: undefined,
      fallbackUsed: false,
      fallbackReason: undefined,
      model: undefined,
      modelUsed: undefined,
      auxModelFailure: undefined,
      mainRetryFailure: undefined,
      warnings: [],
      failure: {
        code: "provider-failed",
        message: "provider unavailable",
        recoverable: undefined
      }
    });
  });

  it("tolerates unknown and malformed future fields", () => {
    const state = reconstructSessionCompressionState([
      {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          trigger: "future-trigger",
          source: {
            startMessageId: "m1",
            messageCount: Number.NaN,
            future: "ignored"
          },
          protectedFirstN: -1,
          protectedLastN: Infinity,
          protectedSpans: [{ messageCount: 2, future: true }, "bad"],
          summaryChars: "500",
          summaryLengthTokens: "500",
          droppedMessageCount: -2,
          lastCompressionSavingsPct: "8.5",
          ineffectiveCompressionCount: -1,
          recentSavingsRatios: [0.3, "bad", Number.NaN, 0.08, 0.09],
          summaryFailureCooldownUntil: 123,
          fallbackUsed: "yes",
          fallbackReason: 123,
          auxModelFailure: {
            code: "network",
            message: "x".repeat(600),
            recoverable: true,
            future: "ignored"
          },
          warnings: ["kept", 123],
          futureField: { ok: true }
        }
      }
    ]);

    expect(state.status).toBe("compressed");
    expect(state.trigger).toBeUndefined();
    expect(state.source).toEqual({ startMessageId: "m1", endMessageId: undefined, messageCount: 0, estimatedTokens: undefined });
    expect(state.protectedFirstN).toBe(0);
    expect(state.protectedLastN).toBe(0);
    expect(state.protectedSpans).toEqual([{ startMessageId: undefined, endMessageId: undefined, messageCount: 2 }]);
    expect(state.summaryChars).toBeUndefined();
    expect(state.summaryLengthTokens).toBeUndefined();
    expect(state.droppedMessageCount).toBeUndefined();
    expect(state.lastCompressionSavingsPct).toBeUndefined();
    expect(state.ineffectiveCompressionCount).toBe(0);
    expect(state.recentSavingsRatios).toEqual([0.08, 0.09]);
    expect(state.summaryFailureCooldownUntil).toBeUndefined();
    expect(state.fallbackUsed).toBe(false);
    expect(state.fallbackReason).toBeUndefined();
    expect(state.auxModelFailure).toEqual({
      code: "network",
      message: "x".repeat(500),
      recoverable: true
    });
    expect(state.warnings).toEqual(["kept"]);
  });

  it("hydrates old state events without observability fields", () => {
    const state = reconstructSessionCompressionState([
      {
        kind: "session-compression-state",
        state: {
          status: "compressed",
          protectedFirstN: 1,
          protectedLastN: 2,
          protectedSpans: [],
          summaryEstimatedTokens: 42,
          ineffectiveCompressionCount: 1,
          fallbackUsed: false,
          warnings: []
        }
      }
    ]);

    expect(state.compressionCount).toBe(0);
    expect(state.previousSummary).toBeUndefined();
    expect(state.lastCompressedThroughMessageId).toBeUndefined();
    expect(state.lastPromptTokensEstimated).toBeUndefined();
    expect(state.lastActualPromptTokens).toBeUndefined();
    expect(state.summaryLengthTokens).toBe(42);
    expect(state.sourceMessageCount).toBeUndefined();
    expect(state.protectedMessageCount).toBeUndefined();
    expect(state.ineffectiveCompressionCount).toBe(1);
  });
});
