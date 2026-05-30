import { describe, expect, it } from "vitest";
import {
  createOpenAICompatibleProvider,
  parseOpenAICompatibleResponse
} from "./openai-compatible-provider.js";
import type { ProviderEndpoint } from "../contracts/provider.js";

describe("createOpenAICompatibleProvider health", () => {
  it("checks the adapter default endpoint when no override is passed", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "openai" as any,
      endpoint: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: { kind: "env", name: "MISSING_KEY" }
      }
    });

    const health = await provider.health();
    expect(health.available).toBe(false);
    expect(health.reason).toContain("MISSING_KEY");
  });

  it("checks the effective endpoint when an override is passed", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "openai" as any,
      endpoint: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: { kind: "env", name: "MISSING_KEY" }
      }
    });

    const overrideEndpoint: ProviderEndpoint = {
      baseUrl: "https://custom.example.com/v1",
      apiKey: { kind: "env", name: "CUSTOM_KEY" }
    };

    const health = await provider.health(overrideEndpoint);
    expect(health.available).toBe(false);
    expect(health.reason).toContain("CUSTOM_KEY");
    expect(health.reason).not.toContain("MISSING_KEY");
  });

  it("returns available when the override endpoint has no env key requirement", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "openai" as any,
      endpoint: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: { kind: "env", name: "MISSING_KEY" }
      }
    });

    const overrideEndpoint: ProviderEndpoint = {
      baseUrl: "https://custom.example.com/v1",
      apiKey: { kind: "none" }
    };

    const health = await provider.health(overrideEndpoint);
    expect(health.available).toBe(true);
  });
});

describe("parseOpenAICompatibleResponse", () => {
  it.each([
    ["stop", "stop"],
    ["length", "length"],
    ["tool_calls", "tool_calls"],
    ["function_call", "tool_calls"],
    ["content_filter", "content_filter"],
    ["unexpected", "unknown"],
    [undefined, "unknown"]
  ] as const)("maps finish_reason %s to %s", (finishReason, expected) => {
    const response = parseOpenAICompatibleResponse({
      provider: "openai",
      model: "gpt-test",
      payload: {
        choices: [
          {
            finish_reason: finishReason,
            message: {
              content: "Done"
            }
          }
        ]
      }
    });

    expect(response.ok).toBe(true);
    expect(response.finishReason).toBe(expected);
  });

  it("maps token usage including reasoning tokens", () => {
    const response = parseOpenAICompatibleResponse({
      provider: "openai",
      model: "gpt-test",
      payload: {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "Done"
            }
          }
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
          completion_tokens_details: {
            reasoning_tokens: 3
          }
        }
      }
    });

    expect(response.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      reasoningTokens: 3
    });
  });
});
