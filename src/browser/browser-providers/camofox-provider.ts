import type { BrowserProvider } from "../browser-provider.js";

export const camofoxProvider: BrowserProvider = {
  name: "camofox",
  displayName: "Camofox",
  getAvailability: () => ({
    available: false,
    reason: "Camofox browser provider is registered but not yet implemented."
  }),
  async createSession() {
    throw new Error("Camofox browser provider is not yet implemented.");
  },
  closeSession: () => false,
  emergencyCleanup: () => undefined
};
