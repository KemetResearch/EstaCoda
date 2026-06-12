#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { URL } from "node:url";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
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
export const DEFAULT_INBOUND_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_INBOUND_MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
  const inboundMediaDir = typeof options?.inboundMediaDir === "string" && options.inboundMediaDir.length > 0
    ? resolve(options.inboundMediaDir)
    : undefined;
  const inboundMediaParentDir = typeof options?.inboundMediaParentDir === "string" && options.inboundMediaParentDir.length > 0
    ? resolve(options.inboundMediaParentDir)
    : undefined;
  const maxInboundMediaBytes = typeof options?.maxInboundMediaBytes === "number" && options.maxInboundMediaBytes > 0
    ? options.maxInboundMediaBytes
    : DEFAULT_INBOUND_MEDIA_MAX_BYTES;
  const mediaDownloader = options?.mediaDownloader ?? ((message) => downloadMediaMessage(message, "buffer", {}, {
    logger,
    reuploadRequest: socket?.updateMediaMessage?.bind(socket),
  }));
  const maxResponseBytes = typeof options?.maxResponseBytes === "number" && options.maxResponseBytes > 0
    ? options.maxResponseBytes
    : MAX_RESPONSE_BYTES;
  const queue = [];
  let droppedMessages = 0;
  let status = "connecting";
  let lastError;
  let socket;
  const startedAt = Date.now();
  let validatedInboundMediaDir;

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
        const result = await sendWithTimeout(() => requireSocket(socket).sendMessage(
          input.chatId,
          { text: input.message },
          quotedOptions(input.chatId, input.replyTo)
        ));
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
      if (inboundMediaDir !== undefined) {
        validatedInboundMediaDir = await ensureDirectoryUnderAllowedRoot(inboundMediaDir, inboundMediaParentDir);
        if (validatedInboundMediaDir === undefined) {
          throw bridgeError(500, "invalid_inbound_media_dir", "WhatsApp inbound media directory is not profile-local.");
        }
        await cleanupInboundMediaDir(validatedInboundMediaDir, DEFAULT_INBOUND_MEDIA_RETENTION_MS);
      }
      socket = await createWhatsAppSocket({ authDir, logger, printQRInTerminal });
      socket.ev.on("messages.upsert", async (event) => {
        for (const message of event.messages ?? []) {
          const normalized = await normalizeInboundMessage(message, {
            inboundMediaDir: validatedInboundMediaDir,
            maxInboundMediaBytes,
            mediaDownloader,
          });
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
  if (value.replyTo !== undefined && value.replyTo !== null && typeof value.replyTo !== "string") {
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

function quotedOptions(chatId, replyTo) {
  if (typeof replyTo !== "string" || replyTo.length === 0) return undefined;
  return {
    quoted: {
      key: {
        id: replyTo,
        remoteJid: chatId,
      },
      message: {},
    },
  };
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

export async function normalizeInboundMessage(message, options = {}) {
  const key = message?.key;
  const messageId = key?.id;
  const chatId = key?.remoteJid;
  if (typeof messageId !== "string" || typeof chatId !== "string") return undefined;
  const content = unwrapMessageContent(message.message);
  const media = detectInboundMedia(content);
  const senderId = key.participant ?? chatId;
  const body = content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    content?.documentMessage?.caption ??
    "";
  const attachments = media === undefined
    ? undefined
    : [await normalizeInboundAttachment(message, media, {
      inboundMediaDir: options.inboundMediaDir,
      maxInboundMediaBytes: options.maxInboundMediaBytes ?? DEFAULT_INBOUND_MEDIA_MAX_BYTES,
      mediaDownloader: options.mediaDownloader ?? ((value) => downloadMediaMessage(value, "buffer", {})),
    })];
  return {
    messageId,
    chatId,
    senderId,
    senderName: message.pushName,
    isGroup: chatId.endsWith("@g.us"),
    fromMe: key.fromMe === true,
    body,
    hasMedia: media !== undefined,
    mediaType: media?.kind,
    attachments,
    timestamp: typeof message.messageTimestamp === "number" ? message.messageTimestamp : undefined,
  };
}

function unwrapMessageContent(content) {
  return content?.ephemeralMessage?.message ??
    content?.viewOnceMessage?.message ??
    content?.viewOnceMessageV2?.message ??
    content?.documentWithCaptionMessage?.message ??
    content;
}

function detectInboundMedia(content) {
  if (!isRecord(content)) return undefined;
  if (isRecord(content.imageMessage)) return { kind: "image", source: content.imageMessage, baileysType: "imageMessage" };
  if (isRecord(content.videoMessage)) return { kind: "video", source: content.videoMessage, baileysType: "videoMessage" };
  if (isRecord(content.audioMessage)) {
    return {
      kind: content.audioMessage.ptt === true ? "voice" : "audio",
      source: content.audioMessage,
      baileysType: "audioMessage",
    };
  }
  if (isRecord(content.documentMessage)) return { kind: "document", source: content.documentMessage, baileysType: "documentMessage" };
  if (isRecord(content.stickerMessage)) return { kind: "image", source: content.stickerMessage, baileysType: "stickerMessage", unsupported: true };
  return undefined;
}

async function normalizeInboundAttachment(message, media, options) {
  const id = `${message.key?.id ?? "message"}:${media.baileysType}`;
  const base = {
    id,
    kind: media.kind,
    mimeType: typeof media.source.mimetype === "string" ? media.source.mimetype : undefined,
    originalName: safeOriginalName(media.source.fileName),
    metadata: {
      whatsappMediaType: media.baileysType,
    },
  };
  if (media.unsupported === true) {
    return failedAttachment(base, "unsupported_media", "WhatsApp media could not be downloaded.");
  }
  if (typeof options.inboundMediaDir !== "string" || options.inboundMediaDir.length === 0) {
    return failedAttachment(base, "download_failed", "WhatsApp media could not be downloaded.");
  }
  const declaredBytes = mediaByteLength(media.source.fileLength);
  if (declaredBytes !== undefined && declaredBytes > options.maxInboundMediaBytes) {
    return failedAttachment({ ...base, bytes: declaredBytes }, "media_too_large", "WhatsApp media could not be downloaded.");
  }
  try {
    const bytes = await options.mediaDownloader(message);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buffer.length > options.maxInboundMediaBytes) {
      return failedAttachment({ ...base, bytes: buffer.length }, "media_too_large", "WhatsApp media could not be downloaded.");
    }
    const localPath = await writeInboundMedia(buffer, {
      inboundMediaDir: options.inboundMediaDir,
      messageId: message.key?.id,
      kind: media.kind,
      mimeType: base.mimeType,
      originalName: base.originalName,
    });
    return {
      ...base,
      status: "ready",
      localPath,
      bytes: buffer.length,
    };
  } catch {
    return failedAttachment(base, "download_failed", "WhatsApp media could not be downloaded.");
  }
}

async function writeInboundMedia(buffer, input) {
  const root = resolve(input.inboundMediaDir);
  await mkdir(root, { recursive: true });
  const extension = safeExtension(input.originalName) || extensionForMime(input.mimeType) || extensionForKind(input.kind);
  const filename = [
    sanitizePathPart(String(input.messageId ?? "message")),
    sanitizePathPart(input.kind),
    randomUUID(),
  ].join("-") + extension;
  const target = resolve(root, filename);
  if (!isPathInside(target, root)) {
    throw new Error("Resolved inbound media path escaped the media directory.");
  }
  await writeFile(target, buffer, { mode: 0o600 });
  return target;
}

async function cleanupInboundMediaDir(rootPath, maxAgeMs) {
  const root = resolve(rootPath);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const target = resolve(root, entry.name);
    if (!isPathInside(target, root)) continue;
    const info = await stat(target).catch(() => undefined);
    if (info !== undefined && info.mtimeMs < cutoff) {
      await rm(target, { force: true }).catch(() => undefined);
    }
  }
}

function failedAttachment(base, failureCode, failureMessage) {
  return {
    ...base,
    status: "failed",
    failureCode,
    failureMessage,
  };
}

function mediaByteLength(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  if (isRecord(value) && typeof value.low === "number") {
    const high = typeof value.high === "number" ? value.high : 0;
    if (!Number.isFinite(high) || high < 0) return Number.POSITIVE_INFINITY;
    if (high > 0) {
      const low = value.low >>> 0;
      const computed = high * 2 ** 32 + low;
      return Number.isSafeInteger(computed) ? computed : Number.POSITIVE_INFINITY;
    }
    return value.low;
  }
  return undefined;
}

function safeOriginalName(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const name = basename(value).replace(/[\u0000-\u001f]+/gu, "").slice(0, 160);
  return name.length > 0 ? name : undefined;
}

function safeExtension(value) {
  if (typeof value !== "string") return "";
  const extension = extname(value).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : "";
}

function extensionForMime(mimeType) {
  const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/mp4") return ".m4a";
  if (mime === "application/pdf") return ".pdf";
  if (mime.startsWith("text/")) return ".txt";
  return "";
}

function extensionForKind(kind) {
  if (kind === "image") return ".img";
  if (kind === "video") return ".mp4";
  if (kind === "audio" || kind === "voice") return ".ogg";
  return ".bin";
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

function sanitizePathPart(value) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
  return sanitized.length > 0 ? sanitized : "media";
}

function isPathInside(candidate, root) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function ensureDirectoryUnderAllowedRoot(path, root) {
  if (typeof root !== "string" || root.length === 0) return undefined;
  await mkdir(root, { recursive: true }).catch(() => undefined);
  const allowedRoot = await realpathSafe(root);
  if (allowedRoot === undefined) return undefined;
  const candidatePath = resolve(path);
  const ancestor = await nearestExistingAncestor(candidatePath);
  if (ancestor === undefined) return undefined;
  const canonicalCandidatePath = join(ancestor.realpath, relative(ancestor.path, candidatePath));
  if (!isPathInside(canonicalCandidatePath, allowedRoot) || !isPathInside(ancestor.realpath, allowedRoot)) {
    return undefined;
  }
  await mkdir(candidatePath, { recursive: true });
  const candidate = await realpathSafe(candidatePath);
  return candidate !== undefined && isPathInside(candidate, allowedRoot) ? candidate : undefined;
}

async function nearestExistingAncestor(path) {
  let current = path;
  for (;;) {
    const resolved = await realpathSafe(current);
    if (resolved !== undefined) return { path: current, realpath: resolved };
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function realpathSafe(path) {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
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
  const inboundMediaDir = args.get("inbound-media-dir") ?? process.env.WHATSAPP_INBOUND_MEDIA_DIR;
  const inboundMediaParentDir = args.get("inbound-media-parent-dir") ?? process.env.WHATSAPP_INBOUND_MEDIA_PARENT_DIR;
  const maxInboundMediaBytes = Number(process.env.WHATSAPP_INBOUND_MEDIA_MAX_BYTES ?? DEFAULT_INBOUND_MEDIA_MAX_BYTES);
  validateBindHost(host);
  const bridge = createBridgeServer({ authDir, token, printQRInTerminal: pairOnly, inboundMediaDir, inboundMediaParentDir, maxInboundMediaBytes });
  bridge.server.listen(port, host.replace(/^\[(.*)\]$/u, "$1"), async () => {
    console.log("ESTACODA_WHATSAPP_BRIDGE_READY");
    try {
      await bridge.startSocket();
    } catch (error) {
      console.error(`WhatsApp bridge socket start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
