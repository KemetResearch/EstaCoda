import { describe, it, expect } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";

function fakeLoadedChannels(): LoadedRuntimeConfig["channels"] {
  return {
    telegram: { enabled: true, ready: true, botTokenEnv: "BOT_TOKEN", allowedUserIds: ["123"] },
    discord: { enabled: true, ready: false, missing: ["DISCORD_BOT_TOKEN"] },
    email: { enabled: false, ready: false },
    whatsapp: { enabled: true, ready: false, experimental: true, missing: ["authDir"] },
  } as unknown as LoadedRuntimeConfig["channels"];
}

describe("AdapterRegistry", () => {
  it("returns all 4 capabilities", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    expect(registry.all().length).toBe(4);
    expect(registry.all().map((c) => c.kind)).toEqual(["telegram", "discord", "email", "whatsapp"]);
  });

  it("filters enabled channels", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    const enabled = registry.enabled();
    expect(enabled.length).toBe(3);
    expect(enabled.map((c) => c.kind)).toEqual(["telegram", "discord", "whatsapp"]);
  });

  it("filters configured channels (enabled + no missing)", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    const configured = registry.configured();
    expect(configured.length).toBe(1);
    expect(configured[0].kind).toBe("telegram");
  });

  it("finds a single capability by kind", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    const cap = registry.get("telegram");
    expect(cap).toBeDefined();
    expect(cap!.kind).toBe("telegram");
    expect(cap!.enabled).toBe(true);
    expect(cap!.configured).toBe(true);
  });

  it("returns undefined for unknown kind", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("returns misconfigured channels", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    const misconfigured = registry.misconfigured();
    expect(misconfigured.length).toBe(2);
    expect(misconfigured.map((c) => c.kind)).toEqual(["discord", "whatsapp"]);
  });

  it("derives missingConfig from loaded config missing array", () => {
    const registry = new AdapterRegistry(fakeLoadedChannels());
    const discord = registry.get("discord");
    expect(discord!.missingConfig).toEqual(["DISCORD_BOT_TOKEN"]);
    const telegram = registry.get("telegram");
    expect(telegram!.missingConfig).toBeUndefined();
  });

  it("is consistent with buildAdapterCapability", () => {
    const channels = fakeLoadedChannels();
    const registry = new AdapterRegistry(channels);
    const all = registry.all();

    for (const cap of all) {
      if (cap.enabled && cap.missingConfig === undefined) {
        expect(cap.configured).toBe(true);
      } else {
        expect(cap.configured).toBe(false);
      }
    }
  });
});
