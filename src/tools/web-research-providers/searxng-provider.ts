import type { WebResearchProvider } from "../web-research-provider.js";

export const searxngProvider: WebResearchProvider = {
  name: "searxng",
  displayName: "SearXNG",
  capabilities: { search: true },
  getAvailability: () => process.env.SEARXNG_URL === undefined
    ? { available: false, reason: "SEARXNG_URL is missing." }
    : { available: false, reason: "SearXNG provider is configured but not yet implemented." }
};
