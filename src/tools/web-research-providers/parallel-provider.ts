import type { WebResearchProvider } from "../web-research-provider.js";

export const parallelProvider: WebResearchProvider = {
  name: "parallel",
  displayName: "Parallel",
  capabilities: { search: true },
  getAvailability: () => process.env.PARALLEL_API_KEY === undefined
    ? { available: false, reason: "PARALLEL_API_KEY is missing." }
    : { available: false, reason: "Parallel provider is configured but not yet implemented." }
};
