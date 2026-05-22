import type { WebResearchProvider } from "../web-research-provider.js";

export const ddgsProvider: WebResearchProvider = {
  name: "ddgs",
  displayName: "DDGS",
  capabilities: { search: true },
  getAvailability: () => ({ available: false, reason: "DDGS provider is not yet implemented." })
};
