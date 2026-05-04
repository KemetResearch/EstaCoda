import { createFakeChannelAdapter } from "./fake-channel-adapter.js";

export function createFakeWhatsAppAdapter(options: { shouldFailDelivery?: boolean; failureMessage?: string } = {}) {
  return createFakeChannelAdapter({
    kind: "whatsapp",
    shouldFailDelivery: options.shouldFailDelivery,
    failureMessage: options.failureMessage
  });
}
