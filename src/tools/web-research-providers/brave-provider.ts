import type { WebResearchProvider } from "../web-research-provider.js";

export const braveProvider: WebResearchProvider = {
  name: "brave",
  displayName: "Brave Search",
  capabilities: { search: true },
  getAvailability: () => process.env.BRAVE_SEARCH_API_KEY === undefined
    ? { available: false, reason: "BRAVE_SEARCH_API_KEY is missing." }
    : { available: false, reason: "Brave Search provider is configured but not yet implemented." }
};
