import { access, constants, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../config/home-dir.js";

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
  const bridgeDir = options.bridgeDir ?? defaultBridgeDir();

  const authDirWritable = await canWrite(authDir);
  if (!authDirWritable) {
    missing.push("authDirWritable");
  }

  const bridgePackagePresent = await canRead(join(bridgeDir, "package.json"));
  const bridgeLockfilePresent = await canRead(join(bridgeDir, "package-lock.json"));
  const bridgeEntrypointPresent = await canRead(join(bridgeDir, "bridge.js"));
  const bridgeReadmePresent = await canRead(join(bridgeDir, "README.md"));
  const bridgeDependenciesInstalled = await bridgeHasInstalledDependencies(bridgeDir);

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
    allowedUsers: undefined,
    missing,
  };
}

function defaultBridgeDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "whatsapp-bridge");
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

async function bridgeHasInstalledDependencies(bridgeDir: string): Promise<boolean> {
  const packageJsonPath = join(bridgeDir, "package.json");
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = Object.keys(parsed.dependencies ?? {});
    if (dependencies.length === 0) return true;
    for (const dependency of dependencies) {
      if (!await canRead(join(bridgeDir, "node_modules", dependency, "package.json"))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
