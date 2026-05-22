import { browserbaseProvider } from "./browser-providers/browserbase-provider.js";
import { browserUseProvider } from "./browser-providers/browser-use-provider.js";
import { camofoxProvider } from "./browser-providers/camofox-provider.js";
import { firecrawlBrowserProvider } from "./browser-providers/firecrawl-provider.js";
import type { BrowserProvider, BrowserProviderConfig, ProviderAvailability } from "./browser-provider.js";

const providers = new Map<string, BrowserProvider>();
const AUTO_DETECT_ORDER = ["browser-use", "browserbase"] as const;

export type BrowserProviderSelection = {
  provider?: BrowserProvider;
  providerName?: string;
  availability: ProviderAvailability;
  explicit: boolean;
};

export function registerBrowserProvider(provider: BrowserProvider): void {
  providers.set(provider.name, provider);
}

export function listBrowserProviders(): BrowserProvider[] {
  return Array.from(providers.values());
}

export function getBrowserProvider(name: string): BrowserProvider | undefined {
  return providers.get(name);
}

export function resetBrowserProvidersForTest(): void {
  providers.clear();
}

export function registerDefaultBrowserProviders(): void {
  for (const provider of [
    browserUseProvider,
    browserbaseProvider,
    firecrawlBrowserProvider,
    camofoxProvider
  ]) {
    registerBrowserProvider(provider);
  }
}

export async function selectBrowserProvider(config: BrowserProviderConfig = {}): Promise<BrowserProviderSelection> {
  if (config.cloudProvider !== undefined) {
    return selectExplicitProvider(config.cloudProvider);
  }

  if (config.backend === "local-cdp" || config.backend === "mock" || config.backend === "unconfigured") {
    return {
      availability: { available: false, reason: "No cloud browser provider selected." },
      explicit: false
    };
  }

  for (const name of AUTO_DETECT_ORDER) {
    const provider = providers.get(name);
    if (provider === undefined) {
      continue;
    }
    const availability = await provider.getAvailability();
    if (availability.available) {
      return { provider, providerName: provider.name, availability, explicit: false };
    }
  }

  return {
    availability: { available: false, reason: "No available cloud browser provider configured." },
    explicit: false
  };
}

async function selectExplicitProvider(name: string): Promise<BrowserProviderSelection> {
  const provider = providers.get(name);
  if (provider === undefined) {
    return {
      providerName: name,
      availability: { available: false, reason: `Unknown browser provider: ${name}.` },
      explicit: true
    };
  }

  return {
    provider,
    providerName: provider.name,
    availability: await provider.getAvailability(),
    explicit: true
  };
}
