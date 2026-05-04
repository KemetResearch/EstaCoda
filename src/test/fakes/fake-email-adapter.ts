import { createFakeChannelAdapter } from "./fake-channel-adapter.js";

export function createFakeEmailAdapter(options: { shouldFailDelivery?: boolean; failureMessage?: string } = {}) {
  return createFakeChannelAdapter({
    kind: "email",
    shouldFailDelivery: options.shouldFailDelivery,
    failureMessage: options.failureMessage
  });
}
