import type { AdapterCapability, ChannelKind } from "../contracts/channel.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import { buildAdapterCapability } from "./adapter-capability.js";

/**
 * Static registry that collects adapter capabilities from loaded config.
 * Does NOT instantiate adapters and does NOT track runtime state.
 */
export class AdapterRegistry {
  readonly #capabilities: AdapterCapability[];

  constructor(channels: LoadedRuntimeConfig["channels"]) {
    this.#capabilities = [
      buildAdapterCapability({ kind: "telegram", config: channels.telegram, missing: channels.telegram.missing }),
      buildAdapterCapability({ kind: "discord", config: channels.discord, missing: channels.discord.missing }),
      buildAdapterCapability({ kind: "email", config: channels.email, missing: channels.email.missing }),
      buildAdapterCapability({ kind: "whatsapp", config: channels.whatsapp, missing: channels.whatsapp.missing }),
    ];
  }

  /** All capabilities, including disabled channels */
  all(): AdapterCapability[] {
    return [...this.#capabilities];
  }

  /** Only enabled channels */
  enabled(): AdapterCapability[] {
    return this.#capabilities.filter((c) => c.enabled);
  }

  /** Only configured (enabled + no missing config) channels */
  configured(): AdapterCapability[] {
    return this.#capabilities.filter((c) => c.configured);
  }

  /** Get single capability by kind */
  get(kind: string): AdapterCapability | undefined {
    return this.#capabilities.find((c) => c.kind === kind);
  }

  /** Channels with missing config */
  misconfigured(): AdapterCapability[] {
    return this.#capabilities.filter((c) => c.enabled && c.missingConfig !== undefined && c.missingConfig.length > 0);
  }
}
