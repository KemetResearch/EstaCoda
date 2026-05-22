import type { BrowserProvider } from "../browser-provider.js";

export const firecrawlBrowserProvider: BrowserProvider = {
  name: "firecrawl",
  displayName: "Firecrawl Browser",
  getAvailability: () => ({
    available: false,
    reason: "Firecrawl browser provider is registered for compatibility but not yet implemented; web research uses a separate provider."
  }),
  async createSession() {
    throw new Error("Firecrawl browser provider is not yet implemented.");
  },
  closeSession: () => false,
  emergencyCleanup: () => undefined
};
