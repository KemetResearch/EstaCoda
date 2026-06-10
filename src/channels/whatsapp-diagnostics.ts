import { access, constants } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveHomeDir } from "../config/home-dir.js";
import type { WhatsAppChannelConfig } from "../config/runtime-config.js";
import { defaultWhatsAppBridgeDir, getWhatsAppBridgeDependencyStatus } from "./whatsapp-bridge-lifecycle.js";

export type WhatsAppGatewayDiagnostics = {
  adapter: "whatsapp";
  enabled: boolean;
  experimental: boolean;
  ready: boolean;
  statusLabel: string;
  mode?: WhatsAppChannelConfig["mode"];
  dmPolicy?: WhatsAppChannelConfig["dmPolicy"];
  pairingPending: boolean;
  authDir: string;
  authDirWritable: boolean;
  bridgeDir: string;
  bridgePackagePresent: boolean;
  bridgeLockfilePresent: boolean;
  bridgeEntrypointPresent: boolean;
  bridgeReadmePresent: boolean;
  bridgeDependenciesInstalled: boolean;
  queueLength?: number;
  droppedMessages?: number;
  allowedUsers?: string[];
  missing: string[];
};

export async function getWhatsAppGatewayDiagnostics(
  options: { homeDir?: string; gatewayStatePath?: string; bridgeDir?: string; config?: WhatsAppChannelConfig } = {}
): Promise<WhatsAppGatewayDiagnostics> {
  const missing: string[] = [];
  const homeDir = resolveHomeDir(options.homeDir);
  const stateRoot = join(homeDir, ".estacoda");
  const config = options.config ?? {};
  const defaultAuthDir = join(options.gatewayStatePath ?? stateRoot, "whatsapp-auth");
  const authDir = config.authDir ?? defaultAuthDir;
  const authDirProfileLocal = resolve(authDir) === resolve(defaultAuthDir);
  const bridgeDir = options.bridgeDir ?? defaultWhatsAppBridgeDir();
  const allowedUsers = config.allowedUsers ?? [];
  const pairingPending = config.enabled === true && config.dmPolicy === "pairing" && allowedUsers.length === 0;

  const authDirWritable = await canWrite(authDir);
  if (!authDirWritable) {
    missing.push("authDirWritable");
  }
  if (config.authDir !== undefined && !authDirProfileLocal) {
    missing.push("authDirProfileLocal");
  }

  const bridgeStatus = await getWhatsAppBridgeDependencyStatus({ bridgeDir });
  const bridgePackagePresent = bridgeStatus.packagePresent;
  const bridgeLockfilePresent = bridgeStatus.lockfilePresent;
  const bridgeEntrypointPresent = bridgeStatus.entrypointPresent;
  const bridgeReadmePresent = await canRead(join(bridgeDir, "README.md"));
  const bridgeDependenciesInstalled = bridgeStatus.nodeModulesPresent;

  if (!bridgePackagePresent) missing.push("bridgePackage");
  if (!bridgeLockfilePresent) missing.push("bridgeLockfile");
  if (!bridgeEntrypointPresent) missing.push("bridgeEntrypoint");
  if (!bridgeReadmePresent) missing.push("bridgeReadme");
  if (!bridgeDependenciesInstalled) missing.push("bridgeDependencies");
  if (config.enabled === true) {
    if (config.experimental !== true) missing.push("experimental");
    if (allowedUsers.length === 0) {
      missing.push(pairingPending ? "pairingPending" : "allowedUsers");
    }
  }

  let statusLabel = "ok";
  if (config.enabled === false) {
    statusLabel = "disabled";
  } else if (!bridgePackagePresent || !bridgeEntrypointPresent) {
    statusLabel = "bridge missing";
  } else if (!bridgeDependenciesInstalled) {
    statusLabel = "bridge dependencies missing";
  } else if (config.authDir !== undefined && !authDirProfileLocal) {
    statusLabel = "auth directory outside profile WhatsApp state";
  } else if (!authDirWritable) {
    statusLabel = "auth directory not writable";
  } else if (pairingPending) {
    statusLabel = "pairing pending";
  }
  const ready = config.enabled === true && config.experimental === true && missing.length === 0;

  return {
    adapter: "whatsapp",
    enabled: config.enabled === true,
    experimental: config.experimental === true,
    ready,
    statusLabel,
    mode: config.mode,
    dmPolicy: config.dmPolicy,
    pairingPending,
    authDir,
    authDirWritable,
    bridgeDir,
    bridgePackagePresent,
    bridgeLockfilePresent,
    bridgeEntrypointPresent,
    bridgeReadmePresent,
    bridgeDependenciesInstalled,
    queueLength: undefined,
    droppedMessages: undefined,
    allowedUsers,
    missing,
  };
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function canWrite(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
