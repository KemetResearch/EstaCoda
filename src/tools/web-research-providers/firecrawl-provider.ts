import type { WebResearchProvider } from "../web-research-provider.js";

export const firecrawlProvider: WebResearchProvider = {
  name: "firecrawl",
  displayName: "Firecrawl",
  capabilities: { search: true, extract: true, crawl: true },
  getAvailability: () => process.env.FIRECRAWL_API_KEY === undefined
    ? { available: false, reason: "FIRECRAWL_API_KEY is missing." }
    : { available: false, reason: "Firecrawl provider is configured but not yet implemented." }
};
