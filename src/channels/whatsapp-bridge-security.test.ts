import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const bridgePath = join(process.cwd(), "scripts", "whatsapp-bridge", "bridge.js");

describe("WhatsApp bridge HTTP/security contract", () => {
  it("keeps the bridge loopback-only with Host and bearer-token checks", async () => {
    const source = await readFile(bridgePath, "utf8");

    expect(source).toContain("ALLOWED_HOSTS");
    expect(source).toContain("validateHost");
    expect(source).toContain("validateToken");
    expect(source).toContain("ESTACODA_WHATSAPP_BRIDGE_TOKEN");
    expect(source).toContain("refuses non-loopback bind hosts");
    expect(source).toContain("\"127.0.0.1\"");
    expect(source).toContain("\"localhost\"");
    expect(source).toContain("\"[::1]\"");
  });

  it("defines strict endpoint, request-size, timeout, and queue guards", async () => {
    const source = await readFile(bridgePath, "utf8");

    expect(source).toContain("MAX_INBOUND_QUEUE = 100");
    expect(source).toContain("MAX_REQUEST_BYTES");
    expect(source).toContain("MAX_RESPONSE_BYTES");
    expect(source).toContain("BRIDGE_API_VERSION");
    expect(source).toContain("SEND_TIMEOUT_MS");
    expect(source).toContain("request_too_large");
    expect(source).toContain("response_too_large");
    expect(source).toContain("malformed_json");
    expect(source).toContain("operation_timeout");
    for (const endpoint of ["/health", "/messages", "/send", "/edit", "/send-media", "/typing", "/chat/"]) {
      expect(source).toContain(endpoint);
    }
  });

  it("keeps Baileys socket hardening inside the quarantined bridge", async () => {
    const source = await readFile(bridgePath, "utf8");

    expect(source).toContain("fetchLatestBaileysVersion");
    expect(source).toContain("getMessage: async () => undefined");
    expect(source).toContain("syncFullHistory: false");
    expect(source).toContain("markOnlineOnConnect: false");
    expect(source).toContain("DEFAULT_BROWSER = [\"EstaCoda\", \"Chrome\", \"120.0\"]");
  });

  it("classifies logged-out and restart-required bridge states distinctly", async () => {
    const source = await readFile(bridgePath, "utf8");

    expect(source).toContain("whatsapp_logged_out");
    expect(source).toContain("whatsapp_restart_required");
    expect(source).toContain("statusCode === 515");
    expect(source).toContain("retryDelayMs: 1000");
  });
});
