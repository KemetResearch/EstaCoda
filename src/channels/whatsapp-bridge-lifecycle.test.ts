import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ManagedWhatsAppBridgeClient,
  getWhatsAppBridgeDependencyStatus,
  installWhatsAppBridgeDependencies,
  redactBridgeLog,
} from "./whatsapp-bridge-lifecycle.js";
import { WhatsAppBridgeRuntimeError } from "./whatsapp-bridge-errors.js";

class FakeStream extends EventEmitter {
  write(_chunk: unknown) {
    return true;
  }
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  pid?: number;
  exitCode: number | null = null;
  killed = false;

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }

  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  }
}

describe("ManagedWhatsAppBridgeClient", () => {
  let tempDir: string;
  let bridgeDir: string;
  let authDir: string;
  let statePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-lifecycle-"));
    bridgeDir = join(tempDir, "bridge");
    authDir = join(tempDir, "profile", "gateway", "whatsapp-auth");
    statePath = join(authDir, "bridge-state.json");
    await createInstalledBridgeFixture(bridgeDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("captures bridge stdout and stderr to a redacted bridge log", async () => {
    const child = new FakeChild();
    const spawned: unknown[] = [];
    const spawnProcess = vi.fn(() => {
      spawned.push(child);
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from("qr: 1234567890abcdef\n"));
        child.stderr.emit("data", Buffer.from("Authorization: Bearer super-secret-token\n"));
        child.stdout.emit("data", Buffer.from("ESTACODA_WHATSAPP_BRIDGE_READY\n"));
      }, 10);
      return child as any;
    });
    const logPath = join(tempDir, "logs", "bridge.log");
    const client = new ManagedWhatsAppBridgeClient({
      authDir,
      statePath,
      bridgeDir,
      logPath,
      spawnProcess: spawnProcess as any,
      startupTimeoutMs: 1000,
      port: 38123,
    });

    await client.start();

    const log = await readFile(logPath, "utf8");
    expect(log).toContain("qr: [REDACTED]");
    expect(log).toContain("Authorization: Bearer [REDACTED]");
    expect(log).toContain("ESTACODA_WHATSAPP_BRIDGE_READY");
    expect(spawned).toHaveLength(1);
  });

  it("duplicate whatsapp-session lock prevents a second bridge", async () => {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(join(dirname(statePath), "whatsapp-session.lock"), JSON.stringify({
      owner: "estacoda-whatsapp-bridge",
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    const client = new ManagedWhatsAppBridgeClient({ authDir, statePath, bridgeDir });

    await expect(client.start()).rejects.toMatchObject({
      code: "whatsapp_bridge_lock_busy",
      retryable: false,
    });
  });

  it("removes stale EstaCoda-owned PID files before starting", async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const pidPath = join(dirname(statePath), "bridge.pid");
    await writeFile(pidPath, JSON.stringify({
      owner: "estacoda-whatsapp-bridge",
      pid: 99999999,
      startedAt: new Date().toISOString(),
      bridgeDir,
      authDir,
    }));
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => {
      setTimeout(() => child.stdout.emit("data", Buffer.from("ESTACODA_WHATSAPP_BRIDGE_READY\n")), 10);
      return child as any;
    });
    const client = new ManagedWhatsAppBridgeClient({
      authDir,
      statePath,
      bridgeDir,
      pidPath,
      spawnProcess: spawnProcess as any,
      port: 38124,
      startupTimeoutMs: 1000,
      shutdownTimeoutMs: 1,
    });

    await client.start();

    const pidFile = JSON.parse(await readFile(pidPath, "utf8"));
    expect(pidFile.owner).toBe("estacoda-whatsapp-bridge");
    expect(pidFile.pid).toBe(-1);
  });

  it("unknown PID file owner is reported and not killed", async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const pidPath = join(dirname(statePath), "bridge.pid");
    await writeFile(pidPath, JSON.stringify({
      owner: "other-process",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      bridgeDir,
      authDir,
    }));
    const client = new ManagedWhatsAppBridgeClient({ authDir, statePath, bridgeDir, pidPath });

    await expect(client.start()).rejects.toMatchObject({
      code: "whatsapp_bridge_pid_owner_mismatch",
      retryable: false,
    });
  });

  it("cleans lock, PID, and state files when startup times out", async () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child as any);
    const pidPath = join(dirname(statePath), "bridge.pid");
    const lockPath = join(dirname(statePath), "whatsapp-session.lock");
    const client = new ManagedWhatsAppBridgeClient({
      authDir,
      statePath,
      bridgeDir,
      pidPath,
      lockPath,
      spawnProcess: spawnProcess as any,
      startupTimeoutMs: 1,
      shutdownTimeoutMs: 1,
      port: 38125,
    });

    await expect(client.start()).rejects.toMatchObject({
      code: "whatsapp_bridge_start_timeout",
    });

    expect(await canRead(pidPath)).toBe(false);
    expect(await canRead(lockPath)).toBe(false);
    expect(await canRead(statePath)).toBe(false);
  });

  it("passes the profile-local inbound media directory to the bridge process", async () => {
    const child = new FakeChild();
    const inboundMediaDir = join(tempDir, "profile", "channel-media", "whatsapp", "inbound");
    const spawnProcess = vi.fn(() => {
      setTimeout(() => child.stdout.emit("data", Buffer.from("ESTACODA_WHATSAPP_BRIDGE_READY\n")), 10);
      return child as any;
    });
    const client = new ManagedWhatsAppBridgeClient({
      authDir,
      statePath,
      bridgeDir,
      inboundMediaDir,
      inboundMediaParentDir: dirname(dirname(inboundMediaDir)),
      maxInboundMediaBytes: 1234,
      spawnProcess: spawnProcess as any,
      startupTimeoutMs: 1000,
      port: 38126,
    });

    await client.start();

    const [, args, options] = spawnProcess.mock.calls[0]! as unknown as [string, string[], { env?: Record<string, string> }];
    expect(args).toEqual(expect.arrayContaining(["--inbound-media-dir", inboundMediaDir]));
    expect(args).toEqual(expect.arrayContaining(["--inbound-media-parent-dir", dirname(dirname(inboundMediaDir))]));
    expect(options?.env).toMatchObject({
      WHATSAPP_INBOUND_MEDIA_DIR: inboundMediaDir,
      WHATSAPP_INBOUND_MEDIA_PARENT_DIR: dirname(dirname(inboundMediaDir)),
      WHATSAPP_INBOUND_MEDIA_MAX_BYTES: "1234",
    });
  });
});

describe("WhatsApp bridge dependency install helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-wa-bridge-install-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports missing bridge node_modules without changing config", async () => {
    const bridgeDir = join(tempDir, "bridge");
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(join(bridgeDir, "package.json"), "{}\n");
    await writeFile(join(bridgeDir, "package-lock.json"), "{}\n");
    await writeFile(join(bridgeDir, "bridge.js"), "export {};\n");

    const status = await getWhatsAppBridgeDependencyStatus({ bridgeDir });

    expect(status.missing).toContain("node_modules");
  });

  it("install helper reports missing npm clearly", async () => {
    const bridgeDir = join(tempDir, "bridge");
    await createInstalledBridgeFixture(bridgeDir);
    const spawnProcess = vi.fn(() => {
      const child = new FakeChild();
      queueMicrotask(() => child.emit("error", new Error("spawn npm ENOENT")));
      return child as any;
    });

    await expect(installWhatsAppBridgeDependencies({
      bridgeDir,
      logPath: join(tempDir, "install.log"),
      spawnProcess: spawnProcess as any,
      timeoutMs: 100,
    })).rejects.toMatchObject({
      code: "whatsapp_bridge_install_failed",
    });
  });

  it("install helper reports timeout clearly", async () => {
    const bridgeDir = join(tempDir, "bridge");
    await createInstalledBridgeFixture(bridgeDir);
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child as any);

    await expect(installWhatsAppBridgeDependencies({
      bridgeDir,
      logPath: join(tempDir, "install.log"),
      spawnProcess: spawnProcess as any,
      timeoutMs: 1,
    })).rejects.toBeInstanceOf(WhatsAppBridgeRuntimeError);
  });

  it("redacts QR strings, pairing codes, secrets, and auth blobs", () => {
    const log = redactBridgeLog("qr: abcdefghijklmnop pairingCode=123456 token: abcdefghijklmnop creds=secret");
    expect(log).not.toContain("abcdefghijklmnop");
    expect(log).not.toContain("123456");
    expect(log).not.toContain("secret");
  });
});

async function createInstalledBridgeFixture(bridgeDir: string): Promise<void> {
  await mkdir(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys"), { recursive: true });
  await mkdir(join(bridgeDir, "node_modules", "@hapi", "boom"), { recursive: true });
  await writeFile(join(bridgeDir, "package.json"), "{}\n");
  await writeFile(join(bridgeDir, "package-lock.json"), "{}\n");
  await writeFile(join(bridgeDir, "bridge.js"), "export {};\n");
  await writeFile(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys", "package.json"), "{}\n");
  await writeFile(join(bridgeDir, "node_modules", "@hapi", "boom", "package.json"), "{}\n");
}

async function canRead(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
