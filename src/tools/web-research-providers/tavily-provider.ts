import type { WebResearchProvider } from "../web-research-provider.js";

export const tavilyProvider: WebResearchProvider = {
  name: "tavily",
  displayName: "Tavily",
  capabilities: { search: true, extract: true },
  getAvailability: () => process.env.TAVILY_API_KEY === undefined
    ? { available: false, reason: "TAVILY_API_KEY is missing." }
    : { available: false, reason: "Tavily provider is configured but not yet implemented." }
};
