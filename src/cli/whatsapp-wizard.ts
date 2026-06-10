import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, constants, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { resolveHomeDir } from "../config/home-dir.js";
import { readActiveProfile, resolveProfileStateHome } from "../config/profile-home.js";
import {
  loadRuntimeConfig,
  setupWhatsAppConfig,
  type UiLanguage,
  type WhatsAppChannelMode,
  type WhatsAppDmPolicy,
} from "../config/runtime-config.js";
import { HttpWhatsAppBridgeClient } from "../channels/whatsapp-bridge-client.js";
import { WhatsAppBridgeRuntimeError } from "../channels/whatsapp-bridge-errors.js";
import {
  defaultWhatsAppBridgeDir,
  getWhatsAppBridgeDependencyStatus,
  installWhatsAppBridgeDependencies,
  type WhatsAppBridgeDependencyStatus,
} from "../channels/whatsapp-bridge-lifecycle.js";
import type { Prompt } from "./readline-prompt.js";

const DEFAULT_QR_TIMEOUT_MS = 120_000;
const WHATSAPP_AUTH_DIR_NAME = "whatsapp-auth";

export type WhatsAppWizardResult = {
  handled: true;
  exitCode: number;
  output: string;
};

export type WhatsAppPairDeviceOptions = {
  authDir: string;
  bridgeDir: string;
  timeoutMs: number;
  output: { write(chunk: string): void };
};

export type WhatsAppPairDeviceResult =
  | { ok: true }
  | { ok: false; reason: "timeout" | "failed"; message?: string };

export type WhatsAppWizardDependencies = {
  getDependencyStatus?: (options: { bridgeDir?: string }) => Promise<WhatsAppBridgeDependencyStatus>;
  installDependencies?: typeof installWhatsAppBridgeDependencies;
  pairDevice?: (options: WhatsAppPairDeviceOptions) => Promise<WhatsAppPairDeviceResult>;
};

export type WhatsAppWizardOptions = {
  workspaceRoot: string;
  homeDir?: string;
  profileId?: string;
  prompt?: Prompt;
  output?: { write(chunk: string): void };
  dependencies?: WhatsAppWizardDependencies;
};

type WizardCopy = {
  intro: string[];
  installQuestion: string;
  declinedInstall: string;
  installFailed: (message: string) => string;
  modeQuestion: string;
  invalidMode: string;
  allowlistQuestion: string;
  rePairQuestion: string;
  rePairDeclined: string;
  qrIntro: string;
  qrTimeout: string;
  qrFailed: (message: string) => string;
  pairingPending: string;
  success: (path: string) => string;
  cancelled: string;
};

const COPY: Record<UiLanguage, WizardCopy> = {
  en: {
    intro: [
      "EstaCoda WhatsApp setup",
      "WhatsApp uses the unofficial Baileys transport. Meta may suspend accounts that use unofficial libraries.",
      "Transport dependencies stay isolated under scripts/whatsapp-bridge/ and are not root runtime dependencies.",
    ],
    installQuestion: "WhatsApp bridge dependencies are missing. Run npm ci in scripts/whatsapp-bridge/ now? [y/N] ",
    declinedInstall: "WhatsApp setup cancelled. Config was not changed.",
    installFailed: (message) => `WhatsApp bridge dependency install failed: ${message}`,
    modeQuestion: "Use a separate bot WhatsApp number or your personal/self-chat number? [bot/self] ",
    invalidMode: "WhatsApp setup cancelled. Enter bot or self when you run estacoda whatsapp again.",
    allowlistQuestion: "Allowed WhatsApp numbers or JIDs now, comma separated. Leave blank for pairing-pending authorization: ",
    rePairQuestion: "Existing WhatsApp auth is missing or logged out. Clear this profile-local auth dir and re-pair? [y/N] ",
    rePairDeclined: "WhatsApp re-pair cancelled. Config was not changed.",
    qrIntro: "Scan the QR code in this terminal with WhatsApp. Pairing uses QR only.",
    qrTimeout: "Pairing timed out - run estacoda whatsapp to try again.",
    qrFailed: (message) => `WhatsApp QR pairing failed: ${message}`,
    pairingPending: "No allowed users were added. WhatsApp is device-paired but user authorization is pairing-pending.",
    success: (path) => `WhatsApp setup saved to ${path}`,
    cancelled: "WhatsApp setup cancelled. Config was not changed.",
  },
  ar: {
    intro: [
      "إعداد WhatsApp في EstaCoda",
      "يستخدم WhatsApp ناقل Baileys غير الرسمي. قد توقف Meta الحسابات التي تستخدم مكتبات غير رسمية.",
      "تبقى الاعتمادات معزولة داخل scripts/whatsapp-bridge/ وليست ضمن اعتمادات وقت التشغيل الجذرية.",
    ],
    installQuestion: "اعتمادات جسر WhatsApp غير مثبتة. هل تريد تشغيل npm ci داخل scripts/whatsapp-bridge/ الآن؟ [y/N] ",
    declinedInstall: "تم إلغاء إعداد WhatsApp. لم يتم تغيير config.",
    installFailed: (message) => `فشل تثبيت اعتمادات جسر WhatsApp: ${message}`,
    modeQuestion: "هل ستستخدم رقم WhatsApp منفصل للبوت أم رقمك الشخصي/self-chat؟ [bot/self] ",
    invalidMode: "تم إلغاء إعداد WhatsApp. اكتب bot أو self عند تشغيل estacoda whatsapp مرة أخرى.",
    allowlistQuestion: "أرقام WhatsApp أو JIDs المسموح بها الآن، مفصولة بفواصل. اتركها فارغة لحالة dmPolicy pairing: ",
    rePairQuestion: "مصادقة WhatsApp الحالية مفقودة أو logged_out. هل تريد مسح authDir الخاص بهذا profile فقط وإعادة QR؟ [y/N] ",
    rePairDeclined: "تم إلغاء إعادة ربط WhatsApp. لم يتم تغيير config.",
    qrIntro: "امسح QR code في هذا الطرفية باستخدام WhatsApp. الربط يدعم QR فقط.",
    qrTimeout: "Pairing timed out - run estacoda whatsapp to try again.",
    qrFailed: (message) => `فشل ربط WhatsApp عبر QR: ${message}`,
    pairingPending: "لم تتم إضافة allowedUsers. تم ربط جهاز WhatsApp لكن تفويض المستخدمين ما زال pairing-pending.",
    success: (path) => `تم حفظ إعداد WhatsApp في ${path}`,
    cancelled: "تم إلغاء إعداد WhatsApp. لم يتم تغيير config.",
  },
};

export async function runWhatsAppWizard(options: WhatsAppWizardOptions): Promise<WhatsAppWizardResult> {
  const homeDir = resolveHomeDir(options.homeDir);
  const profileId = options.profileId ?? readActiveProfile({ homeDir }).profileId ?? "default";
  const paths = resolveProfileStateHome({ homeDir, profileId });
  const loaded = await loadRuntimeConfig({ workspaceRoot: options.workspaceRoot, homeDir, profileId });
  const locale = loaded.ui.language === "ar" ? "ar" : "en";
  const copy = COPY[locale];
  const lines: string[] = [];
  const write = (chunk: string) => {
    if (options.output !== undefined) {
      options.output.write(chunk);
    } else {
      lines.push(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk);
    }
  };
  const say = (line = "") => lines.push(line);

  for (const line of copy.intro) say(line);
  say("");

  const deps = options.dependencies ?? {};
  const bridgeDir = defaultWhatsAppBridgeDir();
  const getDependencyStatus = deps.getDependencyStatus ?? getWhatsAppBridgeDependencyStatus;
  const installDependencies = deps.installDependencies ?? installWhatsAppBridgeDependencies;
  const pairDevice = deps.pairDevice ?? pairDeviceWithForegroundBridge;
  const dependencyStatus = await getDependencyStatus({ bridgeDir });
  if (dependencyStatus.missing.length > 0) {
    if (!yes(await ask(options.prompt, copy.installQuestion))) {
      say(copy.declinedInstall);
      return finish(1, lines);
    }
    try {
      await installDependencies({ bridgeDir, logPath: join(paths.logsPath, "whatsapp-bridge-install.log") });
    } catch (error) {
      say(copy.installFailed(installErrorMessage(error)));
      return finish(1, lines);
    }
  }

  const authDir = loaded.channels.whatsapp.authDir ?? join(paths.gatewayStatePath, WHATSAPP_AUTH_DIR_NAME);
  const hasExistingWhatsAppConfig = loaded.config.channels?.whatsapp?.enabled === true
    || loaded.config.channels?.whatsapp?.authDir !== undefined;
  const state = hasExistingWhatsAppConfig ? await detectPairingState(authDir) : "fresh";
  if (state !== "fresh") {
    if (!yes(await ask(options.prompt, copy.rePairQuestion))) {
      say(copy.rePairDeclined);
      return finish(1, lines);
    }
    await clearProfileLocalAuthDir(authDir, paths.gatewayStatePath);
  }

  const mode = normalizeMode(await ask(options.prompt, copy.modeQuestion));
  if (mode === undefined) {
    say(copy.invalidMode);
    return finish(1, lines);
  }
  const allowedUsers = normalizeAllowedUsers(await ask(options.prompt, copy.allowlistQuestion));
  const dmPolicy: WhatsAppDmPolicy = allowedUsers.length > 0 ? "allowlist" : "pairing";

  say(copy.qrIntro);
  const qrOutput: string[] = [];
  const pairResult = await pairDevice({
    authDir,
    bridgeDir,
    timeoutMs: DEFAULT_QR_TIMEOUT_MS,
    output: {
      write: (chunk) => {
        if (options.output === undefined) qrOutput.push(chunk);
        write(chunk);
      },
    },
  });
  if (!pairResult.ok) {
    say(pairResult.reason === "timeout" ? copy.qrTimeout : copy.qrFailed(pairResult.message ?? "unknown error"));
    return finish(1, lines);
  }

  const result = await setupWhatsAppConfig({
    workspaceRoot: options.workspaceRoot,
    homeDir,
    profileId,
    input: {
      enabled: true,
      experimental: true,
      authDir,
      allowedUsers,
      mode,
      dmPolicy,
      pairingMode: "qr",
    },
  });
  if (dmPolicy === "pairing") say(copy.pairingPending);
  say(copy.success(result.path));
  return finish(0, lines, qrOutput);
}

async function ask(prompt: Prompt | undefined, question: string): Promise<string | undefined> {
  if (prompt === undefined) return undefined;
  return prompt(question);
}

function finish(exitCode: number, lines: string[], qrOutput: string[] = []): WhatsAppWizardResult {
  const output = [...qrOutput, lines.join("\n")].filter((part) => part.length > 0).join(qrOutput.length > 0 ? "\n" : "");
  return { handled: true, exitCode, output };
}

function yes(value: string | undefined): boolean {
  return /^(y|yes|نعم|ن)$/iu.test((value ?? "").trim());
}

function normalizeMode(value: string | undefined): WhatsAppChannelMode | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "bot") return "bot";
  if (normalized === "self" || normalized === "personal") return "self";
  return undefined;
}

function normalizeAllowedUsers(value: string | undefined): string[] {
  return Array.from(new Set((value ?? "")
    .split(/[,\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)));
}

async function detectPairingState(authDir: string): Promise<"fresh" | "not_paired" | "logged_out"> {
  if (!await canRead(join(authDir, "creds.json"))) return "not_paired";
  try {
    const state = JSON.parse(await readFile(join(authDir, "bridge-state.json"), "utf8")) as { baseUrl?: string; token?: string };
    if (typeof state.baseUrl === "string" && typeof state.token === "string") {
      const health = await new HttpWhatsAppBridgeClient({ baseUrl: state.baseUrl, token: state.token, requestTimeoutMs: 1_000 }).getHealth();
      if (health.status === "logged_out" || health.error?.code === "whatsapp_logged_out") return "logged_out";
    }
  } catch {
    // A stale or absent bridge state should not force a reset when credentials exist.
  }
  return "fresh";
}

async function clearProfileLocalAuthDir(authDir: string, gatewayStatePath: string): Promise<void> {
  const gatewayRoot = resolve(gatewayStatePath);
  const expectedAuthDir = resolve(gatewayRoot, WHATSAPP_AUTH_DIR_NAME);
  const targetAuthDir = resolve(authDir);
  if (targetAuthDir !== expectedAuthDir) {
    throw new Error("Refusing to clear anything except the selected profile WhatsApp auth directory.");
  }
  const realGatewayRoot = await realpathOrUndefined(gatewayRoot);
  const realTargetAuthDir = await realpathOrUndefined(targetAuthDir);
  if (realGatewayRoot !== undefined && realTargetAuthDir !== undefined) {
    if (realTargetAuthDir === realGatewayRoot || !isPathInside(realGatewayRoot, realTargetAuthDir)) {
      throw new Error("Refusing to clear WhatsApp authDir outside the selected profile gateway state directory.");
    }
  }
  await rm(targetAuthDir, { recursive: true, force: true });
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function realpathOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function pairDeviceWithForegroundBridge(options: WhatsAppPairDeviceOptions): Promise<WhatsAppPairDeviceResult> {
  await mkdir(options.authDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [
    join(options.bridgeDir, "bridge.js"),
    "--auth-dir", options.authDir,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--pair-only",
  ], {
    cwd: options.bridgeDir,
    env: { ...process.env, ESTACODA_WHATSAPP_BRIDGE_TOKEN: token },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as ChildProcessWithoutNullStreams;
  const startedAt = Date.now();
  try {
    const ready = waitForPairBridgeReady(child, options.output, options.timeoutMs);
    await ready;
    const client = new HttpWhatsAppBridgeClient({ baseUrl: `http://127.0.0.1:${port}`, token, requestTimeoutMs: 1_000 });
    while (Date.now() - startedAt < options.timeoutMs) {
      try {
        const health = await client.getHealth();
        if (health.status === "connected" && await canRead(join(options.authDir, "creds.json"))) {
          return { ok: true };
        }
      } catch {
        // Keep polling until timeout; QR pairing can take a few seconds after socket start.
      }
      await sleep(1_000);
    }
    return { ok: false, reason: "timeout" };
  } catch (error) {
    if (Date.now() - startedAt >= options.timeoutMs) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
  } finally {
    await terminateChild(child);
  }
}

function waitForPairBridgeReady(
  child: ChildProcessWithoutNullStreams,
  output: { write(chunk: string): void },
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("WhatsApp QR pairing timed out."))), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output.write(text);
      if (text.includes("ESTACODA_WHATSAPP_BRIDGE_READY")) finish(resolve);
    });
    child.stderr.on("data", (chunk: Buffer) => output.write(chunk.toString("utf8")));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code, signal) => finish(() => reject(new Error(`WhatsApp bridge exited during pairing (${code ?? signal ?? "unknown"}).`))));
  });
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close(() => port === undefined ? reject(new Error("Unable to reserve WhatsApp bridge port.")) : resolve(port));
    });
    server.on("error", reject);
  });
}

async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }
  await sleep(250);
  if (child.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch { /* ignore */ }
}

function installErrorMessage(error: unknown): string {
  if (error instanceof WhatsAppBridgeRuntimeError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
