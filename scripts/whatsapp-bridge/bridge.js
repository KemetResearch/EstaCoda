#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { isBoom } from "@hapi/boom";
import pino from "pino";

export const DEFAULT_BROWSER = ["EstaCoda", "Chrome", "120.0"];
export const BRIDGE_API_VERSION = "whatsapp-bridge.v1";
export const MAX_INBOUND_QUEUE = 100;
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const SEND_TIMEOUT_MS = 60_000;

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function createWhatsAppSocket(options) {
  const authDir = requireString(options?.authDir, "authDir");
  const logger = options?.logger ?? pino({ level: "silent" });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({
    auth: state,
    browser: DEFAULT_BROWSER,
    getMessage: async () => undefined,
    logger,
    markOnlineOnConnect: false,
    printQRInTerminal: options?.printQRInTerminal === true,
    syncFullHistory: false,
    version,
  });
  socket.ev.on("creds.update", saveCreds);
  return socket;
}

export function classifyDisconnect(error) {
  const statusCode = disconnectStatusCode(error);
  if (statusCode === DisconnectReason.loggedOut) {
    return {
      code: "whatsapp_logged_out",
      retryable: false,
      statusCode,
    };
  }
  if (statusCode === 515) {
    return {
      code: "whatsapp_restart_required",
      retryable: true,
      retryDelayMs: 1000,
      statusCode,
    };
  }
  return {
    code: "whatsapp_disconnected",
    retryable: true,
    retryDelayMs: 3000,
    statusCode,
  };
}

export function createBridgeServer(options) {
  const token = requireString(options?.token, "token");
  const authDir = requireString(options?.authDir, "authDir");
  const logger = options?.logger ?? pino({ level: "silent" });
  const printQRInTerminal = options?.printQRInTerminal === true;
  const maxResponseBytes = typeof options?.maxResponseBytes === "number" && options.maxResponseBytes > 0
    ? options.maxResponseBytes
    : MAX_RESPONSE_BYTES;
  const queue = [];
  let droppedMessages = 0;
  let status = "connecting";
  let lastError;
  let socket;
  const startedAt = Date.now();

  const server = http.createServer(async (request, response) => {
    try {
      validateHost(request);
      validateToken(request, token);
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          ok: lastError === undefined,
          apiVersion: BRIDGE_API_VERSION,
          status,
          queueLength: queue.length,
          droppedMessages,
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
          error: lastError,
        }, maxResponseBytes);
      }

      if (method === "GET" && url.pathname === "/messages") {
        const messages = [...queue];
        if (sendJson(response, 200, messages, maxResponseBytes)) {
          queue.splice(0, queue.length);
        }
        return;
      }

      if (method === "POST" && url.pathname === "/send") {
        const body = await readJsonBody(request);
        const input = validateSendText(body);
        const result = await sendWithTimeout(() => requireSocket(socket).sendMessage(input.chatId, { text: input.message }));
        return sendJson(response, 200, normalizeSendResult(result), maxResponseBytes);
      }

      if (method === "POST" && url.pathname === "/edit") {
        const body = await readJsonBody(request);
        const input = validateEdit(body);
        const result = await sendWithTimeout(() => requireSocket(socket).sendMessage(input.chatId, {
          text: input.message,
          edit: { id: input.messageId, remoteJid: input.chatId },
        }));
        return sendJson(response, 200, normalizeSendResult(result), maxResponseBytes);
      }

      if (method === "POST" && url.pathname === "/send-media") {
        const body = await readJsonBody(request);
        const input = validateSendMedia(body);
        const content = mediaPayload(input);
        const result = await sendWithTimeout(() => requireSocket(socket).sendMessage(input.chatId, content));
        return sendJson(response, 200, normalizeSendResult(result), maxResponseBytes);
      }

      if (method === "POST" && url.pathname === "/typing") {
        const body = await readJsonBody(request);
        const input = validateTyping(body);
        await sendWithTimeout(() => requireSocket(socket).sendPresenceUpdate(input.state, input.chatId));
        return sendJson(response, 200, { ok: true }, maxResponseBytes);
      }

      if (method === "GET" && url.pathname.startsWith("/chat/")) {
        const chatId = decodeURIComponent(url.pathname.slice("/chat/".length));
        if (chatId.length === 0) throw bridgeError(400, "invalid_request", "chat id is required");
        const exists = await sendWithTimeout(() => requireSocket(socket).onWhatsApp(chatId));
        return sendJson(response, 200, {
          id: chatId,
          isGroup: chatId.endsWith("@g.us"),
          participants: [],
          name: Array.isArray(exists) && exists[0]?.exists ? exists[0].jid : undefined,
        }, maxResponseBytes);
      }

      return sendError(response, 404, "not_found", "Unknown WhatsApp bridge endpoint.", undefined, maxResponseBytes);
    } catch (error) {
      const normalized = normalizeEndpointError(error);
      return sendError(response, normalized.status, normalized.code, normalized.message, normalized.details, maxResponseBytes);
    }
  });

  async function startSocket() {
    try {
      socket = await createWhatsAppSocket({ authDir, logger, printQRInTerminal });
      socket.ev.on("messages.upsert", (event) => {
        for (const message of event.messages ?? []) {
          const normalized = normalizeInboundMessage(message);
          if (normalized === undefined) continue;
          if (queue.length >= MAX_INBOUND_QUEUE) {
            queue.shift();
            droppedMessages += 1;
          }
          queue.push(normalized);
        }
      });
      socket.ev.on("connection.update", (update) => {
        if (update.connection === "open") {
          status = "connected";
          lastError = undefined;
        } else if (update.connection === "connecting") {
          status = "connecting";
        } else if (update.connection === "close") {
          const classified = classifyDisconnect(update.lastDisconnect?.error);
          status = classified.code === "whatsapp_logged_out" ? "logged_out" : "disconnected";
          lastError = {
            code: classified.code,
            message: classified.code === "whatsapp_logged_out"
              ? "WhatsApp bridge is logged out."
              : "WhatsApp bridge disconnected.",
            details: classified,
          };
        }
      });
    } catch (error) {
      const classified = classifyDisconnect(error);
      status = classified.code === "whatsapp_logged_out" ? "logged_out" : "error";
      lastError = {
        code: classified.code,
        message: classified.code === "whatsapp_logged_out"
          ? "WhatsApp bridge is logged out."
          : "WhatsApp bridge socket failed to start.",
        details: classified,
      };
      throw error;
    }
  }

  return {
    server,
    startSocket,
    health: () => ({ status, queueLength: queue.length, droppedMessages, error: lastError }),
  };
}

function disconnectStatusCode(error) {
  if (isBoom(error)) return error.output.statusCode;
  if (typeof error === "object" && error !== null) {
    const maybeStatus = error?.output?.statusCode;
    if (typeof maybeStatus === "number") return maybeStatus;
  }
  return undefined;
}

function validateHost(request) {
  const rawHost = request.headers.host;
  const host = typeof rawHost === "string" ? rawHost.replace(/:\d+$/u, "") : "";
  if (!ALLOWED_HOSTS.has(host)) {
    throw bridgeError(403, "bad_host", "Host header is not allowed.");
  }
}

function validateToken(request, token) {
  const header = request.headers.authorization;
  if (header !== `Bearer ${token}`) {
    throw bridgeError(401, "invalid_token", "WhatsApp bridge bearer token is missing or invalid.");
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(bridgeError(413, "request_too_large", "WhatsApp bridge request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(bridgeError(400, "malformed_json", "Malformed JSON request body."));
      }
    });
    request.on("error", reject);
  });
}

function validateSendText(value) {
  if (!isRecord(value) || typeof value.chatId !== "string" || typeof value.message !== "string") {
    throw bridgeError(400, "invalid_request", "Invalid send text request.");
  }
  return value;
}

function validateEdit(value) {
  if (!isRecord(value) || typeof value.chatId !== "string" || typeof value.messageId !== "string" || typeof value.message !== "string") {
    throw bridgeError(400, "invalid_request", "Invalid edit request.");
  }
  return value;
}

function validateSendMedia(value) {
  if (!isRecord(value) || typeof value.chatId !== "string" || typeof value.filePath !== "string") {
    throw bridgeError(400, "invalid_request", "Invalid send media request.");
  }
  return value;
}

function validateTyping(value) {
  if (!isRecord(value) || typeof value.chatId !== "string" || (value.state !== "composing" && value.state !== "paused")) {
    throw bridgeError(400, "invalid_request", "Invalid typing request.");
  }
  return value;
}

function mediaPayload(input) {
  const caption = typeof input.caption === "string" ? input.caption : undefined;
  const fileName = typeof input.fileName === "string" ? input.fileName : undefined;
  const file = { url: input.filePath };
  if (input.mediaType === "image") return { image: file, caption };
  if (input.mediaType === "video") return { video: file, caption };
  if (input.mediaType === "audio" || input.mediaType === "voice") return { audio: file, ptt: input.mediaType === "voice" };
  return { document: file, caption, fileName };
}

function sendWithTimeout(operation) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(bridgeError(504, "operation_timeout", "WhatsApp bridge operation timed out.")), SEND_TIMEOUT_MS);
    Promise.resolve()
      .then(operation)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function normalizeInboundMessage(message) {
  const key = message?.key;
  const messageId = key?.id;
  const chatId = key?.remoteJid;
  if (typeof messageId !== "string" || typeof chatId !== "string") return undefined;
  const senderId = key.participant ?? chatId;
  const body = message.message?.conversation ??
    message.message?.extendedTextMessage?.text ??
    message.message?.imageMessage?.caption ??
    message.message?.videoMessage?.caption ??
    "";
  return {
    messageId,
    chatId,
    senderId,
    senderName: message.pushName,
    isGroup: chatId.endsWith("@g.us"),
    body,
    timestamp: typeof message.messageTimestamp === "number" ? message.messageTimestamp : undefined,
  };
}

function normalizeSendResult(result) {
  const id = result?.key?.id;
  return {
    ok: true,
    messageId: typeof id === "string" ? id : undefined,
    messageIds: typeof id === "string" ? [id] : undefined,
  };
}

function requireSocket(socket) {
  if (socket === undefined) {
    throw bridgeError(503, "whatsapp_not_paired", "WhatsApp bridge socket is not ready.");
  }
  return socket;
}

function sendJson(response, status, value, maxResponseBytes = MAX_RESPONSE_BYTES, enforceLimit = true) {
  const body = JSON.stringify(value);
  if (enforceLimit && Buffer.byteLength(body) > maxResponseBytes) {
    return sendJson(response, 500, {
      ok: false,
      error: {
        code: "response_too_large",
        message: "WhatsApp bridge response is too large.",
      },
    }, maxResponseBytes, false);
  }
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
  return true;
}

function sendError(response, status, code, message, details, maxResponseBytes = MAX_RESPONSE_BYTES) {
  sendJson(response, status, {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  }, maxResponseBytes, false);
}

function bridgeError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeEndpointError(error) {
  if (typeof error === "object" && error !== null && typeof error.status === "number" && typeof error.code === "string") {
    return {
      status: error.status,
      code: error.code,
      message: error.message ?? "WhatsApp bridge request failed.",
      details: error.details,
    };
  }
  const classified = classifyDisconnect(error);
  return {
    status: classified.code === "whatsapp_logged_out" ? 409 : 500,
    code: classified.code,
    message: classified.code === "whatsapp_logged_out" ? "WhatsApp bridge is logged out." : "WhatsApp bridge request failed.",
    details: classified,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args.set(key.slice(2), "true");
    } else {
      args.set(key.slice(2), next);
      index += 1;
    }
  }
  return args;
}

function validateBindHost(host) {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new Error("WhatsApp bridge refuses non-loopback bind hosts.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const authDir = requireString(args.get("auth-dir"), "auth-dir");
  const host = args.get("host") ?? "127.0.0.1";
  const port = Number(args.get("port") ?? "0");
  const pairOnly = args.get("pair-only") === "true";
  const token = requireString(process.env.ESTACODA_WHATSAPP_BRIDGE_TOKEN, "ESTACODA_WHATSAPP_BRIDGE_TOKEN");
  validateBindHost(host);
  const bridge = createBridgeServer({ authDir, token, printQRInTerminal: pairOnly });
  bridge.server.listen(port, host.replace(/^\[(.*)\]$/u, "$1"), async () => {
    console.log("ESTACODA_WHATSAPP_BRIDGE_READY");
    try {
      await bridge.startSocket();
    } catch (error) {
      console.error(`WhatsApp bridge socket start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
