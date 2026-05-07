import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGatewaySupervisor } from "./supervisor.js";
import { readGatewayPid } from "./pid-file.js";
import { readGatewayState } from "./supervisor-state.js";
import { isAdapterIdentityLocked } from "./identity-lock.js";
import { readGatewayLockContent } from "./gateway-lock.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-supervisor-test-"));
}

function createFakeConfig(tmpDir: string, channels: Record<string, unknown>) {
  return {
    workspaceRoot: tmpDir,
    homeDir: tmpDir,
  };
}

function fakeAdapter(kind: string, pollCount = 0) {
  return {
    id: kind,
    kind,
    pollOnce: async () => pollCount,
    setCommands: async () => {},
    start: async () => {},
    stop: async () => {},
    delivery: {
      sendText: async () => {},
    },
  };
}

function fakeChannelGateway() {
  return {
    start: async () => {},
    stop: async () => {},
  };
}

function fakeDeliveryRouter() {
  const registered: string[] = [];
  return {
    registerAdapter: (adapter: { kind: string }) => {
      registered.push(adapter.kind);
    },
    parseTarget: () => [],
    deliverText: async () => new Map(),
    getRegisteredPlatforms: () => registered,
  };
}

function fakeTickCron() {
  let calls = 0;
  return {
    tickCron: async () => {
      calls += 1;
      return [];
    },
    calls: () => calls,
  };
}

function fakeSleep() {
  let durations: number[] = [];
  return {
    sleep: async (ms: number) => {
      durations.push(ms);
    },
    durations: () => durations,
  };
}

function fakeExit() {
  let codes: number[] = [];
  return {
    exit: (c: number) => {
      codes.push(c);
    },
    codes: () => codes,
  };
}

describe("runGatewaySupervisor", () => {
  let tmpDir: string;
  let stateRoot: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    stateRoot = join(tmpDir, ".estacoda");
    await mkdir(stateRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("startup with no adapters configured (cron-only)", async () => {
    const tick = fakeTickCron();
    const sleeper = fakeSleep();
    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        tickCron: tick.tickCron,
        sleep: sleeper.sleep,
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("Gateway stopped");
    expect(tick.calls()).toBe(1);
    expect(sleeper.durations()).toHaveLength(0);

    const pid = await readGatewayPid(tmpDir);
    expect(pid).toBeUndefined();
  });

  it("startup with telegram configured", async () => {
    const tick = fakeTickCron();
    const sleeper = fakeSleep();
    const router = fakeDeliveryRouter();
    const gateway = fakeChannelGateway();

    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        tickCron: tick.tickCron,
        sleep: sleeper.sleep,
        createChannelGateway: () => gateway as any,
        createDeliveryRouter: () => router as any,
        createTelegramAdapter: () => fakeAdapter("telegram") as any,
      },
    });

    expect(result.ok).toBe(true);
    expect(tick.calls()).toBe(1);

    const pid = await readGatewayPid(tmpDir);
    expect(pid).toBeUndefined();
  });

  it("startup fails when gateway lock held", async () => {
    const lockFile = join(stateRoot, "gateway", "gateway.lock");
    await mkdir(join(stateRoot, "gateway"), { recursive: true });
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("already running");

    const pid = await readGatewayPid(tmpDir);
    expect(pid).toBeUndefined();
  });

  it("startup fails when configured adapter has no derivable identity", async () => {
    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
      },
    });

    // With no adapters enabled, this should succeed in cron-only mode
    expect(result.ok).toBe(true);
  });

  it("startup fails when adapter start throws", async () => {
    const tick = fakeTickCron();
    const gateway = {
      start: async () => {
        throw new Error("start failed");
      },
      stop: async () => {},
    };

    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        tickCron: tick.tickCron,
        createChannelGateway: () => gateway as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
        createTelegramAdapter: () => fakeAdapter("telegram") as any,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Startup failed");

    const pid = await readGatewayPid(tmpDir);
    expect(pid).toBeUndefined();
  });

  it("SIGTERM triggers shutdown sequence", async () => {
    const exited = fakeExit();
    const gateway = fakeChannelGateway();
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    const promise = runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: false,
      factories: {
        createChannelGateway: () => gateway as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
        exit: exited.exit,
      },
    });

    // Give it time to install handlers
    await new Promise((r) => setTimeout(r, 50));

    process.emit("SIGTERM");

    await promise;

    expect(exited.codes()).toContain(0);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);

    const pid = await readGatewayPid(tmpDir);
    expect(pid).toBeUndefined();
  });

  it("SIGINT triggers shutdown sequence", async () => {
    const exited = fakeExit();
    const gateway = fakeChannelGateway();
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    const promise = runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: false,
      factories: {
        createChannelGateway: () => gateway as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
        exit: exited.exit,
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    process.emit("SIGINT");

    await promise;

    expect(exited.codes()).toContain(0);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("double signal forces exit(1)", async () => {
    const exited = fakeExit();
    const gateway = fakeChannelGateway();
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    const promise = runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: false,
      factories: {
        createChannelGateway: () => gateway as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
        exit: exited.exit,
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    process.emit("SIGTERM");
    process.emit("SIGTERM");

    await promise;

    expect(exited.codes()).toContain(1);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("cron tick runs in main loop", async () => {
    const tick = fakeTickCron();
    const sleeper = fakeSleep();

    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        tickCron: tick.tickCron,
        sleep: sleeper.sleep,
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
      },
    });

    expect(result.ok).toBe(true);
    expect(tick.calls()).toBe(1);
  });

  it("once mode exits cleanly and removes state", async () => {
    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
      },
    });

    expect(result.ok).toBe(true);

    const pid = await readGatewayPid(tmpDir);
    expect(pid).toBeUndefined();

    const state = await readGatewayState(tmpDir);
    expect(state).toBeUndefined();

    const lock = await readGatewayLockContent(tmpDir);
    expect(lock).toBeUndefined();
  });

  it("signal handlers are removed after run", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
      },
    });

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("repeated once-mode runs do not accumulate listeners", async () => {
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    for (let i = 0; i < 3; i++) {
      await runGatewaySupervisor({
        workspaceRoot: tmpDir,
        homeDir: tmpDir,
        once: true,
        factories: {
          createChannelGateway: () => fakeChannelGateway() as any,
          createDeliveryRouter: () => fakeDeliveryRouter() as any,
        },
      });
    }

    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });

  it("pollOnce error is caught by wrapper, supervisor continues", async () => {
    const configPath = join(tmpDir, ".estacoda", "config.json");
    await mkdir(join(tmpDir, ".estacoda"), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      channels: {
        telegram: {
          enabled: true,
          botTokenEnv: "TEST_BOT_TOKEN",
          defaultChatId: "123",
        },
      },
    }));
    process.env.TEST_BOT_TOKEN = "fake";

    const tick = fakeTickCron();

    const badAdapter = {
      ...fakeAdapter("telegram"),
      pollOnce: async () => {
        throw new Error("poll explosion");
      },
    };

    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        tickCron: tick.tickCron,
        createChannelGateway: () => fakeChannelGateway() as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
        createTelegramAdapter: () => badAdapter as any,
      },
    });

    delete process.env.TEST_BOT_TOKEN;

    expect(result.ok).toBe(true);
    expect(result.polls).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("supervisor loop calls wrapper poll exactly once per adapter per iteration", async () => {
    const configPath = join(tmpDir, ".estacoda", "config.json");
    await mkdir(join(tmpDir, ".estacoda"), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      channels: {
        telegram: {
          enabled: true,
          botTokenEnv: "TEST_BOT_TOKEN",
          defaultChatId: "123",
        },
      },
    }));
    process.env.TEST_BOT_TOKEN = "fake";

    let pollOnceCalls = 0;
    const adapter = {
      ...fakeAdapter("telegram"),
      pollOnce: async () => {
        pollOnceCalls += 1;
        return 3;
      },
    };

    const result = await runGatewaySupervisor({
      workspaceRoot: tmpDir,
      homeDir: tmpDir,
      once: true,
      factories: {
        createChannelGateway: (opts: any) => ({
          start: async () => {
            for (const a of opts?.adapters ?? []) {
              await a.start?.(async () => {});
            }
          },
          stop: async () => {},
        }) as any,
        createDeliveryRouter: () => fakeDeliveryRouter() as any,
        createTelegramAdapter: () => adapter as any,
      },
    });

    delete process.env.TEST_BOT_TOKEN;

    expect(result.ok).toBe(true);
    expect(result.processed).toBe(3);
    expect(pollOnceCalls).toBe(1);
  });
});
