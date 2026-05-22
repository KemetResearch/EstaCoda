import type { BrowserProvider } from "../browser-provider.js";

export const browserbaseProvider: BrowserProvider = {
  name: "browserbase",
  displayName: "Browserbase",
  getAvailability: () => {
    const missing = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"].filter((name) => process.env[name] === undefined);
    return missing.length > 0
      ? { available: false, reason: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing.` }
      : { available: false, reason: "Browserbase provider is registered but not yet implemented." };
  },
  async createSession() {
    throw new Error("Browserbase browser provider is not yet implemented.");
  },
  closeSession: () => false,
  emergencyCleanup: () => undefined
};
