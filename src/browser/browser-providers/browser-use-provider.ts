import type { BrowserProvider } from "../browser-provider.js";

export const browserUseProvider: BrowserProvider = {
  name: "browser-use",
  displayName: "browser-use",
  getAvailability: () => process.env.BROWSER_USE_API_KEY === undefined
    ? { available: false, reason: "BROWSER_USE_API_KEY is missing." }
    : { available: false, reason: "browser-use provider is configured but not yet implemented." },
  async createSession() {
    throw new Error("browser-use browser provider is not yet implemented.");
  },
  closeSession: () => false,
  emergencyCleanup: () => undefined
};
