import { createFakeChannelAdapter } from "./fake-channel-adapter.js";

export function createFakeTelegramAdapter(options: { shouldFailDelivery?: boolean; failureMessage?: string } = {}) {
  return createFakeChannelAdapter({
    kind: "telegram",
    shouldFailDelivery: options.shouldFailDelivery,
    failureMessage: options.failureMessage
  });
}
