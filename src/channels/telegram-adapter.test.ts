import { describe, it, expect } from "vitest";
import { TelegramAdapter } from "./telegram-adapter.js";
import { buildAdapterCapability } from "./adapter-capability.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";

describe("TelegramAdapter", () => {
  it("getCapabilities exists and returns correct kind", () => {
    const adapter = new TelegramAdapter({ botToken: "test-token" });
    expect(typeof adapter.getCapabilities).toBe("function");
    const cap = adapter.getCapabilities!();
    expect(cap.kind).toBe("telegram");
  });

  it("getCapabilities returns live_proven traits", () => {
    const adapter = new TelegramAdapter({ botToken: "test-token", enabled: true });
    const cap = adapter.getCapabilities!();
    expect(cap.enabled).toBe(true);
    expect(cap.configured).toBe(true);
    expect(cap.inboundMode).toBe("polling");
    expect(cap.outboundMode).toBe("push");
    expect(cap.supportsAttachments).toBe(true);
    expect(cap.supportsThreads).toBe(true);
    expect(cap.supportsApprovals).toBe(true);
    expect(cap.supportsProgressStreaming).toBe(true);
    expect(cap.experimental).toBe(false);
    expect(cap.implementationStatus).toBe("live_proven");
  });

  it("getCapabilities reflects missing config", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      enabled: true,
      missing: ["BOT_TOKEN_ENV"],
    });
    const cap = adapter.getCapabilities!();
    expect(cap.enabled).toBe(true);
    expect(cap.configured).toBe(false);
    expect(cap.missingConfig).toEqual(["BOT_TOKEN_ENV"]);
  });

  it("getCapabilities delegates to shared builder", () => {
    const adapter = new TelegramAdapter({
      botToken: "test-token",
      enabled: false,
      defaultChatId: "123",
      missing: ["BOT_TOKEN_ENV"],
    });
    const cap = adapter.getCapabilities!();
    const expected = buildAdapterCapability({
      kind: "telegram",
      config: {
        enabled: false,
        defaultChatId: "123",
      },
      missing: ["BOT_TOKEN_ENV"],
    });
    expect(cap).toEqual(expected);
  });

  it("getCapabilities matches registry output for same normalized config", () => {
    const channels = {
      telegram: {
        enabled: true,
        ready: false,
        botTokenEnv: "BOT_TOKEN",
        missing: ["BOT_TOKEN_ENV"],
      },
      discord: { enabled: false, ready: false },
      email: { enabled: false, ready: false },
      whatsapp: { enabled: false, ready: false, experimental: false },
    } as unknown as LoadedRuntimeConfig["channels"];

    const adapter = new TelegramAdapter({
      botToken: "test-token",
      enabled: true,
      missing: ["BOT_TOKEN_ENV"],
    });

    const registry = new AdapterRegistry(channels);
    expect(adapter.getCapabilities!()).toEqual(registry.get("telegram"));
  });
});
