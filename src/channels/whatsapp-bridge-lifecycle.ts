import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { access, chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  HttpWhatsAppBridgeClient,
  type WhatsAppBridgeChatInfo,
  type WhatsAppBridgeClient,
  type WhatsAppBridgeEditInput,
  type WhatsAppBridgeHealth,
  type WhatsAppBridgeInboundMessage,
  type WhatsAppBridgeSendMediaInput,
  type WhatsAppBridgeSendResult,
  type WhatsAppBridgeSendTextInput,
  type WhatsAppBridgeState,
  type WhatsAppBridgeTypingInput,
} from "./whatsapp-bridge-client.js";
import { WhatsAppBridgeRuntimeError } from "./whatsapp-bridge-errors.js";

const LOCK_STALE_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const BRIDGE_OWNER = "estacoda-whatsapp-bridge";

export type WhatsAppBridgePidContent = {
  owner: typeof BRIDGE_OWNER;
  pid: number;
  startedAt: string;
  bridgeDir: string;
  authDir: string;
};

export type WhatsAppBridgeLifecycleOptions = {
  authDir: string;
  statePath: string;
  bridgeDir?: string;
  logPath?: string;
  installLogPath?: string;
  pidPath?: string;
  lockPath?: string;
  host?: string;
  port?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  nodeBinary?: string;
  spawnProcess?: typeof spawn;
  now?: () => Date;
};

export type WhatsAppBridgeDependencyStatus = {
  bridgeDir: string;
  packagePresent: boolean;
  lockfilePresent: boolean;
  entrypointPresent: boolean;
  nodeModulesPresent: boolean;
  missing: string[];
};

export type WhatsAppBridgeInstallOptions = {
  bridgeDir?: string;
  logPath: string;
  timeoutMs?: number;
  npmBinary?: string;
  spawnProcess?: typeof spawn;
};

export class ManagedWhatsAppBridgeClient implements WhatsAppBridgeClient {
  readonly #options: Required<Omit<WhatsAppBridgeLifecycleOptions, "port" | "bridgeDir" | "logPath" | "installLogPath" | "pidPath" | "lockPath" | "spawnProcess" | "now">> & {
    bridgeDir: string;
    logPath: string;
    installLogPath: string;
    pidPath: string;
    lockPath: string;
    port?: number;
    spawnProcess: typeof spawn;
    now: () => Date;
  };
  #child?: ChildProcessWithoutNullStreams;
  #client?: HttpWhatsAppBridgeClient;
  #logStream?: WriteStream;
  #state?: WhatsAppBridgeState;

  constructor(options: WhatsAppBridgeLifecycleOptions) {
    this.#options = {
      authDir: options.authDir,
      statePath: options.statePath,
      bridgeDir: options.bridgeDir ?? defaultWhatsAppBridgeDir(),
      logPath: options.logPath ?? join(dirname(options.statePath), "bridge.log"),
      installLogPath: options.installLogPath ?? join(dirname(options.statePath), "bridge-install.log"),
      pidPath: options.pidPath ?? join(dirname(options.statePath), "bridge.pid"),
      lockPath: options.lockPath ?? join(dirname(options.statePath), "whatsapp-session.lock"),
      host: options.host ?? "127.0.0.1",
      port: options.port,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      nodeBinary: options.nodeBinary ?? process.execPath,
      spawnProcess: options.spawnProcess ?? spawn,
      now: options.now ?? (() => new Date()),
    };
  }

  async start(): Promise<void> {
    validateLoopbackHost(this.#options.host);
    const dependencyStatus = await getWhatsAppBridgeDependencyStatus({ bridgeDir: this.#options.bridgeDir });
    if (dependencyStatus.missing.length > 0) {
      throw new WhatsAppBridgeRuntimeError({
        code: "whatsapp_bridge_dependencies_missing",
        message: "WhatsApp bridge dependencies are not installed.",
        details: { missing: dependencyStatus.missing },
      });
    }

    await mkdir(this.#options.authDir, { recursive: true });
    await mkdir(dirname(this.#options.statePath), { recursive: true });
    await this.#acquireLock();
    try {
      await this.#cleanupOwnedStalePid();

      const port = this.#options.port ?? await reserveLoopbackPort(this.#options.host);
      const token = randomBytes(32).toString("hex");
      await mkdir(dirname(this.#options.logPath), { recursive: true });
      this.#logStream = createWriteStream(this.#options.logPath, { flags: "a", mode: 0o600 });
      const bridgeEntrypoint = join(this.#options.bridgeDir, "bridge.js");
      const child = this.#options.spawnProcess(this.#options.nodeBinary, [
        bridgeEntrypoint,
        "--auth-dir", this.#options.authDir,
        "--host", this.#options.host,
        "--port", String(port),
      ], {
        cwd: this.#options.bridgeDir,
        env: {
          ...process.env,
          ESTACODA_WHATSAPP_BRIDGE_TOKEN: token,
        },
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      }) as unknown as ChildProcessWithoutNullStreams;
      this.#child = child;
      await writeJson0600(this.#options.pidPath, {
        owner: BRIDGE_OWNER,
        pid: child.pid ?? -1,
        startedAt: this.#options.now().toISOString(),
        bridgeDir: this.#options.bridgeDir,
        authDir: this.#options.authDir,
      } satisfies WhatsAppBridgePidContent);

      const state = await this.#waitForReady(child, port, token);
      await writeJson0600(this.#options.statePath, state);
      this.#state = state;
      this.#client = new HttpWhatsAppBridgeClient({ ...state });
    } catch (error) {
      await this.#cleanupFailedStart();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    this.#client = undefined;
    this.#state = undefined;
    if (child !== undefined) {
      await terminateChildProcess(child, this.#options.shutdownTimeoutMs);
    }
    await rm(this.#options.pidPath, { force: true });
    await rm(this.#options.statePath, { force: true });
    await rm(this.#options.lockPath, { force: true });
    this.#logStream?.end();
    this.#logStream = undefined;
  }

  async getHealth(): Promise<WhatsAppBridgeHealth> {
    return this.#requireClient().getHealth();
  }

  async pollMessages(): Promise<WhatsAppBridgeInboundMessage[]> {
    return this.#requireClient().pollMessages();
  }

  async sendText(input: WhatsAppBridgeSendTextInput): Promise<WhatsAppBridgeSendResult> {
    return this.#requireClient().sendText(input);
  }

  async editMessage(input: WhatsAppBridgeEditInput): Promise<WhatsAppBridgeSendResult> {
    return this.#requireClient().editMessage(input);
  }

  async sendMedia(input: WhatsAppBridgeSendMediaInput): Promise<WhatsAppBridgeSendResult> {
    return this.#requireClient().sendMedia(input);
  }

  async sendTyping(input: WhatsAppBridgeTypingInput): Promise<WhatsAppBridgeSendResult> {
    return this.#requireClient().sendTyping(input);
  }

  async getChat(chatId: string): Promise<WhatsAppBridgeChatInfo> {
    return this.#requireClient().getChat(chatId);
  }

  #requireClient(): HttpWhatsAppBridgeClient {
    if (this.#client === undefined) {
      throw new WhatsAppBridgeRuntimeError({
        code: "whatsapp_bridge_state_missing",
        message: "WhatsApp bridge is not started.",
      });
    }
    return this.#client;
  }

  async #acquireLock(): Promise<void> {
    await mkdir(dirname(this.#options.lockPath), { recursive: true });
    try {
      const handle = await open(this.#options.lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ owner: BRIDGE_OWNER, pid: process.pid, startedAt: this.#options.now().toISOString() }), "utf8");
      await handle.close();
      await chmod(this.#options.lockPath, 0o600);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "EEXIST") throw error;
      const lock = await readJson(this.#options.lockPath) as { pid?: unknown; startedAt?: unknown } | undefined;
      const startedAt = typeof lock?.startedAt === "string" ? Date.parse(lock.startedAt) : Number.NaN;
      const pid = typeof lock?.pid === "number" ? lock.pid : undefined;
      if (pid !== undefined && (!isPidAlive(pid) || (!Number.isNaN(startedAt) && Date.now() - startedAt > LOCK_STALE_MS))) {
        await rm(this.#options.lockPath, { force: true });
        return this.#acquireLock();
      }
      throw new WhatsAppBridgeRuntimeError({
        code: "whatsapp_bridge_lock_busy",
        message: "WhatsApp bridge session is already locked.",
        details: { pid },
      });
    }
  }

  async #cleanupOwnedStalePid(): Promise<void> {
    const existing = await readJson(this.#options.pidPath) as Partial<WhatsAppBridgePidContent> | undefined;
    if (existing === undefined) return;
    if (
      existing.owner !== BRIDGE_OWNER ||
      existing.bridgeDir !== this.#options.bridgeDir ||
      existing.authDir !== this.#options.authDir
    ) {
      throw new WhatsAppBridgeRuntimeError({
        code: "whatsapp_bridge_pid_owner_mismatch",
        message: "WhatsApp bridge PID file is not owned by this EstaCoda bridge.",
        details: { pid: existing.pid },
      });
    }
    if (typeof existing.pid === "number" && isPidAlive(existing.pid)) {
      await terminatePid(existing.pid, this.#options.shutdownTimeoutMs);
    }
    await rm(this.#options.pidPath, { force: true });
  }

  #waitForReady(child: ChildProcessWithoutNullStreams, port: number, token: string): Promise<WhatsAppBridgeState> {
    const state = { baseUrl: `http://${this.#options.host}:${port}`, token };
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new WhatsAppBridgeRuntimeError({
          code: "whatsapp_bridge_start_timeout",
          message: "WhatsApp bridge did not become ready before the startup timeout.",
        }));
      }, this.#options.startupTimeoutMs);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      child.stdout.on("data", (chunk: Buffer) => {
        const text = redactBridgeLog(chunk.toString("utf8"));
        this.#logStream?.write(text);
        if (text.includes("ESTACODA_WHATSAPP_BRIDGE_READY")) {
          finish(() => resolve(state));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        this.#logStream?.write(redactBridgeLog(chunk.toString("utf8")));
      });
      child.on("exit", (code, signal) => {
        finish(() => reject(new WhatsAppBridgeRuntimeError({
          code: "whatsapp_bridge_exited",
          message: "WhatsApp bridge exited during startup.",
          details: { code, signal },
        })));
      });
      child.on("error", (error) => {
        finish(() => reject(new WhatsAppBridgeRuntimeError({
          code: "whatsapp_bridge_exited",
          message: error.message,
        })));
      });
    });
  }

  async #cleanupFailedStart(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    this.#client = undefined;
    this.#state = undefined;
    if (child !== undefined) {
      await terminateChildProcess(child, this.#options.shutdownTimeoutMs);
    }
    await rm(this.#options.pidPath, { force: true });
    await rm(this.#options.statePath, { force: true });
    await rm(this.#options.lockPath, { force: true });
    this.#logStream?.end();
    this.#logStream = undefined;
  }
}

export function defaultWhatsAppBridgeDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "whatsapp-bridge");
}

export async function getWhatsAppBridgeDependencyStatus(
  options: { bridgeDir?: string } = {}
): Promise<WhatsAppBridgeDependencyStatus> {
  const bridgeDir = options.bridgeDir ?? defaultWhatsAppBridgeDir();
  const packagePresent = await canRead(join(bridgeDir, "package.json"));
  const lockfilePresent = await canRead(join(bridgeDir, "package-lock.json"));
  const entrypointPresent = await canRead(join(bridgeDir, "bridge.js"));
  const nodeModulesPresent = await canRead(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys", "package.json")) &&
    await canRead(join(bridgeDir, "node_modules", "@hapi", "boom", "package.json"));
  const missing: string[] = [];
  if (!packagePresent) missing.push("package.json");
  if (!lockfilePresent) missing.push("package-lock.json");
  if (!entrypointPresent) missing.push("bridge.js");
  if (!nodeModulesPresent) missing.push("node_modules");
  return { bridgeDir, packagePresent, lockfilePresent, entrypointPresent, nodeModulesPresent, missing };
}

export async function installWhatsAppBridgeDependencies(options: WhatsAppBridgeInstallOptions): Promise<void> {
  const bridgeDir = options.bridgeDir ?? defaultWhatsAppBridgeDir();
  const timeoutMs = options.timeoutMs ?? Number(process.env.ESTACODA_WHATSAPP_BRIDGE_INSTALL_TIMEOUT ?? 300_000);
  await mkdir(dirname(options.logPath), { recursive: true });
  const logStream = createWriteStream(options.logPath, { flags: "a", mode: 0o600 });
  const spawnProcess = options.spawnProcess ?? spawn;
  const npmBinary = options.npmBinary ?? "npm";
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const child = spawnProcess(npmBinary, ["ci"], {
      cwd: bridgeDir,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    }) as unknown as ChildProcessWithoutNullStreams;
    const timer = setTimeout(() => {
      finish(() => reject(new WhatsAppBridgeRuntimeError({
        code: "whatsapp_bridge_install_timeout",
        message: "WhatsApp bridge dependency installation timed out.",
      })));
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => logStream.write(redactBridgeLog(chunk.toString("utf8"))));
    child.stderr.on("data", (chunk: Buffer) => logStream.write(redactBridgeLog(chunk.toString("utf8"))));
    child.on("error", (error) => {
      finish(() => reject(new WhatsAppBridgeRuntimeError({
        code: "whatsapp_bridge_install_failed",
        message: error.message,
      })));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        finish(resolve);
      } else {
        finish(() => reject(new WhatsAppBridgeRuntimeError({
          code: "whatsapp_bridge_install_failed",
          message: "WhatsApp bridge dependency installation failed.",
          details: { code },
        })));
      }
    });
  }).finally(() => logStream.end());
}

export function redactBridgeLog(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/(token["'=:\s]+)[A-Za-z0-9._-]{12,}/gu, "$1[REDACTED]")
    .replace(/(pairing[-_ ]?code["'=:\s]+)[A-Za-z0-9._-]+/giu, "$1[REDACTED]")
    .replace(/(qr["'=:\s]+)[A-Za-z0-9+/=._:-]{16,}/giu, "$1[REDACTED]")
    .replace(/(creds|authState|noiseKey|signedIdentityKey|advSecretKey)["'=:\s]+[^\s,}]+/giu, "$1=[REDACTED]");
}

function validateLoopbackHost(host: string): void {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new WhatsAppBridgeRuntimeError({
      code: "whatsapp_bridge_state_invalid",
      message: "WhatsApp bridge host must be loopback-only.",
      details: { host },
    });
  }
}

async function reserveLoopbackPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host.replace(/^\[(.*)\]$/u, "$1"), () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close(() => {
        if (typeof port === "number") resolve(port);
        else reject(new Error("Unable to reserve WhatsApp bridge port."));
      });
    });
    server.on("error", reject);
  });
}

async function writeJson0600(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function terminateChildProcess(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return;
  await terminatePid(child.pid ?? -1, timeoutMs);
}

async function terminatePid(pid: number, timeoutMs: number): Promise<void> {
  if (pid <= 0) return;
  const signalPid = process.platform === "win32" ? pid : -pid;
  try {
    process.kill(signalPid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  if (isPidAlive(pid)) {
    try {
      process.kill(signalPid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
