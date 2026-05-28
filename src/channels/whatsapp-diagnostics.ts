import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { resolveHomeDir } from "../config/home-dir.js";

export type WhatsAppGatewayDiagnostics = {
  adapter: "whatsapp";
  enabled: boolean;
  experimental: boolean;
  ready: boolean;
  statusLabel: string;
  authDir: string;
  authDirWritable: boolean;
  baileysAvailable: boolean;
  allowedUsers?: string[];
  missing: string[];
};

export async function getWhatsAppGatewayDiagnostics(
  options: { homeDir?: string; gatewayStatePath?: string } = {}
): Promise<WhatsAppGatewayDiagnostics> {
  const missing: string[] = [];
  const homeDir = resolveHomeDir(options.homeDir);
  const stateRoot = join(homeDir, ".estacoda");
  const authDir = join(options.gatewayStatePath ?? stateRoot, "whatsapp-auth");

  let baileysAvailable = false;
  try {
    const mod = await import("@whiskeysockets/baileys");
    if (mod) baileysAvailable = true;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("@whiskeysockets/baileys");
      if (mod) baileysAvailable = true;
    } catch {
      baileysAvailable = false;
    }
  }

  if (!baileysAvailable) {
    missing.push("@whiskeysockets/baileys");
  }

  let authDirWritable = false;
  try {
    await access(authDir, constants.W_OK);
    authDirWritable = true;
  } catch {
    authDirWritable = false;
  }

  if (!authDirWritable) {
    missing.push("authDirWritable");
  }

  let statusLabel = "ok";
  if (!baileysAvailable) {
    statusLabel = "baileys missing";
  } else if (!authDirWritable) {
    statusLabel = "auth directory not writable";
  }

  return {
    adapter: "whatsapp",
    enabled: false,
    experimental: false,
    ready: false,
    statusLabel,
    authDir,
    authDirWritable,
    baileysAvailable,
    allowedUsers: undefined,
    missing,
  };
}
