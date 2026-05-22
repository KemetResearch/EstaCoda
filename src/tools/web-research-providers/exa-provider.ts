import type { WebResearchProvider } from "../web-research-provider.js";

export const exaProvider: WebResearchProvider = {
  name: "exa",
  displayName: "Exa",
  capabilities: { search: true },
  getAvailability: () => process.env.EXA_API_KEY === undefined
    ? { available: false, reason: "EXA_API_KEY is missing." }
    : { available: false, reason: "Exa provider is configured but not yet implemented." }
};
