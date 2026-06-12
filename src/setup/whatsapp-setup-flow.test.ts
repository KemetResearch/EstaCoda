import { describe, expect, it } from "vitest";
import { stripPairBridgeReadySentinel } from "./whatsapp-setup-flow.js";

describe("WhatsApp setup flow output filtering", () => {
  it("removes the internal bridge ready sentinel from user-facing output", () => {
    expect(stripPairBridgeReadySentinel("ESTACODA_WHATSAPP_BRIDGE_READY\n")).toBe("");
    expect(stripPairBridgeReadySentinel("[QR]\nESTACODA_WHATSAPP_BRIDGE_READY\n")).toBe("[QR]\n");
  });
});
