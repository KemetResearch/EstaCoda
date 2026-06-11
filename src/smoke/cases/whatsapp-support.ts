import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { SmokeCase } from "../smoke-case.js";
import { resolveProfileStateHome } from "../../config/profile-home.js";
import { readConfig } from "../../config/runtime-config.js";
import {
  runWhatsAppWizard,
  type WhatsAppPairDeviceOptions,
  type WhatsAppWizardDependencies,
} from "../../cli/whatsapp-wizard.js";
import type { Prompt } from "../../cli/readline-prompt.js";

export const whatsapp_support_case: SmokeCase = {
  id: "whatsapp-support",
  name: "WhatsApp wizard, docs boundary, and package quarantine smoke",
  tags: ["gateway", "whatsapp", "package"],
  run: async () => {
    assertRootPackageBoundary();

    const tempRoot = await mkdtemp(join(tmpdir(), "estacoda-smoke-whatsapp-"));
    try {
      await assertDeclinedInstallLeavesConfigUnchanged(join(tempRoot, "decline"));
      await assertCancellationLeavesConfigUnchanged(join(tempRoot, "cancel"));
      await assertSuccessfulSetupWritesOnlyExpectedKeys(join(tempRoot, "success"));
      await assertArabicWizardCopyPreservesTechnicalTokens(join(tempRoot, "arabic"));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
};

function assertRootPackageBoundary(): void {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    files?: string[];
  };
  const bridgePackage = JSON.parse(readFileSync("scripts/whatsapp-bridge/package.json", "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const rootDeps = {
    ...(rootPackage.dependencies ?? {}),
    ...(rootPackage.devDependencies ?? {}),
  };
  for (const dependency of ["@whiskeysockets/baileys", "@hapi/boom"]) {
    if (dependency in rootDeps) {
      throw new Error(`Root package must not depend on ${dependency}`);
    }
    if (!(dependency in (bridgePackage.dependencies ?? {}))) {
      throw new Error(`Bridge package must own ${dependency}`);
    }
  }

  const files = new Set(rootPackage.files ?? []);
  const expectedBridgeFiles = [
    "scripts/whatsapp-bridge/package.json",
    "scripts/whatsapp-bridge/package-lock.json",
    "scripts/whatsapp-bridge/bridge.js",
    "scripts/whatsapp-bridge/README.md",
  ];
  for (const file of expectedBridgeFiles) {
    if (!files.has(file)) {
      throw new Error(`Root package files must include ${file}`);
    }
  }
  if ([...files].some((file) => file.startsWith("scripts/whatsapp-bridge/node_modules"))) {
    throw new Error("Root package files must not include bridge node_modules");
  }
}

async function assertDeclinedInstallLeavesConfigUnchanged(homeDir: string): Promise<void> {
  await mkdir(homeDir, { recursive: true });
  const deps = missingBridgeDeps();
  const result = await runWhatsAppWizard({
    workspaceRoot: homeDir,
    homeDir,
    prompt: fakePrompt(["n"]),
    dependencies: deps,
  });
  if (result.exitCode === 0 || !result.output.includes("Config was not changed")) {
    throw new Error(`Expected declined install to cancel without config mutation, got: ${result.output}`);
  }
  if (await configLoaded(homeDir)) {
    throw new Error("Declined bridge dependency install must not create profile config");
  }
}

async function assertCancellationLeavesConfigUnchanged(homeDir: string): Promise<void> {
  await mkdir(homeDir, { recursive: true });
  const result = await runWhatsAppWizard({
    workspaceRoot: homeDir,
    homeDir,
    prompt: fakePrompt(["cancel"]),
    dependencies: installedBridgeDeps(),
  });
  if (result.exitCode === 0 || !result.output.includes("Enter bot or self")) {
    throw new Error(`Expected wizard cancellation before QR pairing, got: ${result.output}`);
  }
  if (await configLoaded(homeDir)) {
    throw new Error("Cancelled WhatsApp wizard must not create profile config");
  }
}

async function assertSuccessfulSetupWritesOnlyExpectedKeys(homeDir: string): Promise<void> {
  await mkdir(homeDir, { recursive: true });
  const result = await runWhatsAppWizard({
    workspaceRoot: homeDir,
    homeDir,
    prompt: fakePrompt(["bot", "971501234567"]),
    dependencies: installedBridgeDeps(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`Expected WhatsApp setup success, got: ${result.output}`);
  }

  const config = await readConfig(resolveProfileStateHome({ homeDir, profileId: "default" }).configPath);
  const whatsapp = config.config.channels?.whatsapp as Record<string, unknown> | undefined;
  const expectedKeys = [
    "allowedGroups",
    "allowedUsers",
    "authDir",
    "dmPolicy",
    "enabled",
    "experimental",
    "freeResponseChats",
    "groupPolicy",
    "mentionPatterns",
    "mode",
    "pairingMode",
    "replyPrefix",
  ];
  if (whatsapp === undefined) throw new Error("WhatsApp config was not written");
  if (JSON.stringify(Object.keys(whatsapp).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Unexpected WhatsApp config keys: ${Object.keys(whatsapp).sort().join(", ")}`);
  }
  if (whatsapp.dmPolicy !== "allowlist" || whatsapp.mode !== "bot") {
    throw new Error(`Unexpected WhatsApp config policy/mode: ${JSON.stringify(whatsapp)}`);
  }
}

async function assertArabicWizardCopyPreservesTechnicalTokens(homeDir: string): Promise<void> {
  const paths = resolveProfileStateHome({ homeDir, profileId: "default" });
  await mkdir(dirname(paths.configPath), { recursive: true });
  await writeFile(paths.configPath, JSON.stringify({ ui: { language: "ar" } }), "utf8");

  const result = await runWhatsAppWizard({
    workspaceRoot: homeDir,
    homeDir,
    prompt: fakePrompt(["cancel"]),
    dependencies: installedBridgeDeps(),
  });
  for (const token of ["WhatsApp", "Baileys", "scripts/whatsapp-bridge/", "estacoda whatsapp"]) {
    if (!result.output.includes(token)) {
      throw new Error(`Arabic WhatsApp wizard output must preserve ${token}`);
    }
  }
}

function fakePrompt(answers: string[]): Prompt {
  return (async () => answers.shift() ?? "") as Prompt;
}

function missingBridgeDeps(): WhatsAppWizardDependencies {
  return {
    getDependencyStatus: async () => ({
      bridgeDir: "/tmp/bridge",
      packagePresent: true,
      lockfilePresent: true,
      entrypointPresent: true,
      nodeModulesPresent: false,
      missing: ["node_modules"],
    }),
    installDependencies: async () => undefined,
    pairDevice: async () => ({ ok: true }),
  };
}

function installedBridgeDeps(): WhatsAppWizardDependencies {
  return {
    getDependencyStatus: async () => ({
      bridgeDir: "/tmp/bridge",
      packagePresent: true,
      lockfilePresent: true,
      entrypointPresent: true,
      nodeModulesPresent: true,
      missing: [],
    }),
    installDependencies: async () => undefined,
    pairDevice: async (options: WhatsAppPairDeviceOptions) => {
      await mkdir(options.authDir, { recursive: true });
      await writeFile(join(options.authDir, "creds.json"), "{}\n", "utf8");
      return { ok: true };
    },
  };
}

async function configLoaded(homeDir: string): Promise<boolean> {
  return (await readConfig(resolveProfileStateHome({ homeDir, profileId: "default" }).configPath)).loaded;
}
