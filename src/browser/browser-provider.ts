import type { BrowserCloudProviderKind } from "../contracts/browser.js";

export type ProviderAvailability = {
  available: boolean;
  reason?: string;
};

export type BrowserProviderSession = {
  sessionName: string;
  providerSessionId: string;
  cdpUrl: string;
  features: Record<string, boolean>;
};

export type BrowserProvider = {
  name: BrowserCloudProviderKind;
  displayName: string;
  getAvailability(): ProviderAvailability | Promise<ProviderAvailability>;
  createSession(taskId: string): Promise<BrowserProviderSession>;
  closeSession(providerSessionId: string): Promise<boolean> | boolean;
  emergencyCleanup(providerSessionId: string): Promise<void> | void;
};

export type BrowserProviderConfig = {
  backend?: string;
  cloudProvider?: string;
};
