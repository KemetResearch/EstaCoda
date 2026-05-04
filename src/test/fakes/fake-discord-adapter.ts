import { createFakeChannelAdapter } from "./fake-channel-adapter.js";

export function createFakeDiscordAdapter(options: { shouldFailDelivery?: boolean; failureMessage?: string } = {}) {
  return createFakeChannelAdapter({
    kind: "discord",
    shouldFailDelivery: options.shouldFailDelivery,
    failureMessage: options.failureMessage
  });
}
