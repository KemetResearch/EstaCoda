import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { resolveHomeDir } from "../config/home-dir.js";
import { defaultWhatsAppBridgeDir, getWhatsAppBridgeDependencyStatus } from "./whatsapp-bridge-lifecycle.js";

export type WhatsAppGatewayDiagnostics = {
  adapter: "whatsapp";
  enabled: boolean;
  experimental: boolean;
  ready: boolean;
  statusLabel: string;
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
  options: { homeDir?: string; gatewayStatePath?: string; bridgeDir?: string } = {}
): Promise<WhatsAppGatewayDiagnostics> {
  const missing: string[] = [];
  const homeDir = resolveHomeDir(options.homeDir);
  const stateRoot = join(homeDir, ".estacoda");
  const authDir = join(options.gatewayStatePath ?? stateRoot, "whatsapp-auth");
  const bridgeDir = options.bridgeDir ?? defaultWhatsAppBridgeDir();

  const authDirWritable = await canWrite(authDir);
  if (!authDirWritable) {
    missing.push("authDirWritable");
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

  let statusLabel = "ok";
  if (!bridgePackagePresent || !bridgeEntrypointPresent) {
    statusLabel = "bridge missing";
  } else if (!bridgeDependenciesInstalled) {
    statusLabel = "bridge dependencies missing";
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
    bridgeDir,
    bridgePackagePresent,
    bridgeLockfilePresent,
    bridgeEntrypointPresent,
    bridgeReadmePresent,
    bridgeDependenciesInstalled,
    queueLength: undefined,
    droppedMessages: undefined,
    allowedUsers: undefined,
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
