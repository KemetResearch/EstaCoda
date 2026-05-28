import { describe, expect, it } from "vitest";
import { IMAGE_TOKEN_ESTIMATE } from "./token-estimator.js";
import { deriveSessionHistoryBudget, packSessionHistory } from "./history-packer.js";

describe("deriveSessionHistoryBudget", () => {
  it("scales history budget with model context window", () => {
    expect(deriveSessionHistoryBudget(128_000)).toBe(15_360);
    expect(deriveSessionHistoryBudget(262_000)).toBe(24_000);
    expect(deriveSessionHistoryBudget(32_000)).toBe(6_000);
    expect(deriveSessionHistoryBudget(undefined)).toBe(15_360);
  });
});

describe("packSessionHistory", () => {
  it("includes image attachment metadata in estimated history tokens", () => {
    const textOnly = packSessionHistory([
      {
        id: "text",
        sessionId: "session",
        role: "user",
        content: "Please inspect this."
      }
    ], { maxProtectedMessages: 1 });
    const withImage = packSessionHistory([
      {
        id: "image",
        sessionId: "session",
        role: "user",
        content: "Please inspect this.",
        metadata: {
          attachments: [
            { kind: "image", status: "ready" }
          ]
        }
      }
    ], { maxProtectedMessages: 1 });

    expect(withImage.estimatedTokens).toBeGreaterThanOrEqual(textOnly.estimatedTokens + IMAGE_TOKEN_ESTIMATE);
  });

  it("keeps text-only history estimates stable when no image metadata is present", () => {
    const first = packSessionHistory([
      {
        id: "text",
        sessionId: "session",
        role: "user",
        content: "A text-only turn."
      }
    ], { maxProtectedMessages: 1 });
    const second = packSessionHistory([
      {
        id: "text",
        sessionId: "session",
        role: "user",
        content: "A text-only turn."
      }
    ], { maxProtectedMessages: 1 });

    expect(second.estimatedTokens).toBe(first.estimatedTokens);
  });

  it("preserves the original user question through a high-tool turn when trimming is required", () => {
    const messages = [
      {
        id: "q1",
        sessionId: "s",
        role: "user" as const,
        content: "okay i want you to go and research hermes agent"
      },
      {
        id: "a1",
        sessionId: "s",
        role: "agent" as const,
        content: "I will research Hermes agent for you."
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `t${index + 1}`,
        sessionId: "s",
        role: "tool" as const,
        content: `tool ${index + 1} output `.repeat(500)
      })),
      {
        id: "q2",
        sessionId: "s",
        role: "user" as const,
        content: "but that wasnt my question to you"
      }
    ];

    const packed = packSessionHistory(messages, {
      maxEstimatedTokens: 2_000,
      maxMessageChars: 2_000,
      maxProtectedMessages: 6
    });
    const content = packed.messages.map((message) => message.content).join("\n");
    const toolCount = packed.messages.filter((message) => message.role === "tool").length;

    expect(packed.messages.some((message) => message.role === "system")).toBe(true);
    expect(toolCount).toBeLessThan(9);
    expect(content).toContain("research hermes agent");
  });

  it("evicts tool messages before session summaries when trimming", () => {
    const messages = [
      {
        id: "q1",
        sessionId: "s",
        role: "user" as const,
        content: "original question about Hermes agent architecture"
      },
      {
        id: "a1",
        sessionId: "s",
        role: "agent" as const,
        content: "Initial answer about Hermes."
      },
      {
        id: "q2",
        sessionId: "s",
        role: "user" as const,
        content: "Follow-up before tool work."
      },
      {
        id: "a2",
        sessionId: "s",
        role: "agent" as const,
        content: "I will inspect the codebase."
      },
      {
        id: "a3",
        sessionId: "s",
        role: "agent" as const,
        content: "Running a few checks now."
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `tool-${index + 1}`,
        sessionId: "s",
        role: "tool" as const,
        content: `large curl output ${index + 1} `.repeat(500)
      })),
      {
        id: "q3",
        sessionId: "s",
        role: "user" as const,
        content: "what was my original question?"
      }
    ];

    const packed = packSessionHistory(messages, {
      maxEstimatedTokens: 500,
      maxMessageChars: 2_000,
      maxProtectedMessages: 6
    });
    const content = packed.messages.map((message) => message.content).join("\n");

    expect(packed.messages.some((message) => message.role === "system")).toBe(true);
    expect(packed.messages.some((message) => message.role === "tool")).toBe(false);
    expect(content).toContain("original question about Hermes agent architecture");
  });
});
