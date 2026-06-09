#!/usr/bin/env node
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { isBoom } from "@hapi/boom";
import pino from "pino";

export const DEFAULT_BROWSER = ["EstaCoda", "Chrome", "120.0"];

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

function disconnectStatusCode(error) {
  if (isBoom(error)) return error.output.statusCode;
  if (typeof error === "object" && error !== null) {
    const maybeStatus = error?.output?.statusCode;
    if (typeof maybeStatus === "number") return maybeStatus;
  }
  return undefined;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.error("EstaCoda WhatsApp bridge lifecycle is not implemented in this commit.");
  process.exit(1);
}
