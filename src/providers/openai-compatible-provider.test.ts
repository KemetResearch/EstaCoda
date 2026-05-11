import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider.js";
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
