import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpWhatsAppBridgeClient, WhatsAppBridgeClientError } from "./whatsapp-bridge-client.js";

describe("HttpWhatsAppBridgeClient", () => {
  let tempDir: string;
  let statePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-client-"));
    statePath = join(tempDir, "bridge-state.json");
    await writeFile(statePath, JSON.stringify({ baseUrl: "http://127.0.0.1:1234", token: "secret-token" }));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads state and sends the bearer token", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret-token" });
      return jsonResponse({ ok: true, apiVersion: "whatsapp-bridge.v1", status: "connected", queueLength: 0, droppedMessages: 0 });
    });
    const client = new HttpWhatsAppBridgeClient({ statePath, fetch: fetchMock as any });

    await expect(client.getHealth()).resolves.toMatchObject({ ok: true, status: "connected" });
  });

  it("validates malformed health responses", async () => {
    const client = new HttpWhatsAppBridgeClient({
      statePath,
      fetch: vi.fn(async () => jsonResponse({ status: "connected" })) as any,
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      code: "whatsapp_bridge_response_invalid",
    });
  });

  it("validates the expected bridge API version in health responses", async () => {
    const client = new HttpWhatsAppBridgeClient({
      statePath,
      fetch: vi.fn(async () => jsonResponse({ ok: true, apiVersion: "wrong", status: "connected" })) as any,
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      code: "whatsapp_bridge_response_invalid",
    });
  });

  it("exposes send, edit, media, typing, and chat endpoints", async () => {
    const paths: string[] = [];
    const bodies: unknown[] = [];
    const client = new HttpWhatsAppBridgeClient({
      statePath,
      fetch: vi.fn(async (url: URL, init?: RequestInit) => {
        paths.push(url.pathname);
        if (typeof init?.body === "string") bodies.push(JSON.parse(init.body) as unknown);
        if (url.pathname.startsWith("/chat/")) return jsonResponse({ id: "chat@s.whatsapp.net" });
        return jsonResponse({ ok: true, messageId: "msg-1", messageIds: ["msg-1"] });
      }) as any,
    });

    await client.sendText({ chatId: "chat@s.whatsapp.net", message: "hello", replyTo: "incoming-1" });
    await client.editMessage({ chatId: "chat@s.whatsapp.net", messageId: "msg-1", message: "edited" });
    await client.sendMedia({ chatId: "chat@s.whatsapp.net", filePath: "/tmp/file.txt", mediaType: "document" });
    await client.sendTyping({ chatId: "chat@s.whatsapp.net", state: "composing" });
    await client.getChat("chat@s.whatsapp.net");

    expect(paths).toEqual(["/send", "/edit", "/send-media", "/typing", "/chat/chat%40s.whatsapp.net"]);
    expect(bodies[0]).toMatchObject({ replyTo: "incoming-1" });
  });

  it("normalizes structured bridge errors", async () => {
    const client = new HttpWhatsAppBridgeClient({
      statePath,
      fetch: vi.fn(async () => jsonResponse({
        ok: false,
        error: { code: "whatsapp_logged_out", message: "logged out" },
      }, 409)) as any,
    });

    await expect(client.sendText({ chatId: "chat", message: "hello" })).rejects.toMatchObject({
      code: "whatsapp_logged_out",
      retryable: false,
    });
  });

  it("times out stalled bridge requests", async () => {
    const client = new HttpWhatsAppBridgeClient({
      statePath,
      requestTimeoutMs: 1,
      fetch: vi.fn((_url: URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as any,
    });

    await expect(client.getHealth()).rejects.toBeInstanceOf(WhatsAppBridgeClientError);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  } as Response;
}
