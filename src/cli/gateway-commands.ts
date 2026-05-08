import { join } from "node:path";
import { access, constants } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { getTelegramGatewayDiagnostics } from "../channels/gateway-runner.js";
import { getWhatsAppGatewayDiagnostics } from "../channels/whatsapp-diagnostics.js";
import { CronStore } from "../cron/cron-store.js";
import { CronExecutionStore } from "../cron/cron-execution-store.js";
import { ChannelApprovalStore } from "../channels/channel-approval-store.js";
import { FileSurfacePointerStore } from "../channels/surface-pointer-store.js";
import { DeliveryRouter } from "../channels/delivery-router.js";
import { AdapterRegistry } from "../channels/adapter-registry.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { ViewModel } from "../contracts/view-model.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import {
  buildGatewayStatusViewModel,
  buildGatewayDiagnoseViewModel,
  buildChannelsListViewModel,
  buildChannelsStatusViewModel,
} from "./gateway-view-models.js";
import type {
  GatewayStatusData,
  GatewayDiagnoseData,
  ChannelsStatusData,
} from "./gateway-view-models.js";
import type { TelegramGatewayDiagnostics } from "../channels/gateway-runner.js";
import type { WhatsAppGatewayDiagnostics } from "../channels/whatsapp-diagnostics.js";
import { readGatewayPid, isStalePid } from "../gateway/pid-file.js";
import { readGatewayState } from "../gateway/supervisor-state.js";
import { isStaleLock } from "../gateway/gateway-lock.js";
import { stopGateway } from "../gateway/supervisor-lifecycle.js";
import { listAdapterIdentityLocks } from "../gateway/identity-lock.js";
import {
  deriveTelegramIdentityHash,
  deriveDiscordIdentityHash,
  deriveEmailIdentityHash,
  deriveWhatsAppIdentityHash,
} from "../channels/adapter-identity.js";
import type { IdentityLockStatus } from "./gateway-view-models.js";
import { readAdapterRuntimeState, isRuntimeStateFresh, isRuntimeStatePidMatch } from "../gateway/adapter-runtime-state.js";
import type { PersistedRuntimeState } from "../gateway/adapter-runtime-state.js";
import {
  runtimeCacheStatePath,
  readRuntimeCacheState,
  isRuntimeCacheStateFresh,
  isRuntimeCacheStatePidMatch,
  type RuntimeCacheState,
} from "../gateway/runtime-cache-state.js";

export type GatewayCommandOptions = {
  homeDir?: string;
  workspaceRoot: string;
  userConfigPath?: string;
  projectConfigPath?: string;
};

export type GatewayRenderer = (viewModel: ViewModel) => string;

// ─────────────────────────────────────────────────────────────
// Gateway Status
// ─────────────────────────────────────────────────────────────

export async function runGatewayStatus(
  options: GatewayCommandOptions,
  renderer: GatewayRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const config = await loadRuntimeConfig(options);
  const homeDir = options.homeDir ?? process.env.HOME ?? ".estacoda";
  const stateRoot = join(homeDir, ".estacoda");

  const cronStore = new CronStore({ homeDir });
  const cronJobs = await cronStore.list();

  let executionStore: CronExecutionStore | undefined;
  try {
    const dbPath = join(stateRoot, "sessions.sqlite");
    const db = new Database(dbPath);
    executionStore = new CronExecutionStore(db);
  } catch { /* ignore */ }

  let recentCronFailures: Awaited<ReturnType<CronExecutionStore["recentFailures"]>> = [];
  if (executionStore !== undefined) {
    try {
      recentCronFailures = await executionStore.recentFailures(5);
    } catch { /* table may not exist */ }
  }

  const deliveryRouter = new DeliveryRouter({ homeDir });
  const recentDeliveryErrors = await deliveryRouter.getRecentErrors(5);

  const surfacePointerStore = new FileSurfacePointerStore({ path: join(stateRoot, "surface-pointers.json") });
  const surfacePointers = await surfacePointerStore.listPointers();

  const approvalStore = new ChannelApprovalStore({ path: join(stateRoot, "channel-approvals.json") });
  const allApprovals = await approvalStore.listAll();

  const missingConfig: { channel: string; item: string }[] = [];
  if (config.channels.telegram.missing !== undefined) {
    missingConfig.push(...config.channels.telegram.missing.map((m) => ({ channel: "telegram", item: m })));
  }
  if (config.channels.discord.missing !== undefined) {
    missingConfig.push(...config.channels.discord.missing.map((m) => ({ channel: "discord", item: m })));
  }
  if (config.channels.email.missing !== undefined) {
    missingConfig.push(...config.channels.email.missing.map((m) => ({ channel: "email", item: m })));
  }
  if (config.channels.whatsapp.missing !== undefined) {
    missingConfig.push(...config.channels.whatsapp.missing.map((m) => ({ channel: "whatsapp", item: m })));
  }

  const state = await readGatewayState(homeDir);
  const pidContent = await readGatewayPid(homeDir);

  const identityLocks = await buildIdentityLockStatuses(homeDir, config.channels);

  const runtimeState = await readAdapterRuntimeState(homeDir);
  const supervisorLive = pidContent !== undefined && !(await isStalePid(homeDir));
  const runtimeStateValid = runtimeState !== undefined
    && isRuntimeStateFresh(runtimeState)
    && isRuntimeStatePidMatch(runtimeState, pidContent?.pid ?? -1)
    && supervisorLive;

  // Trust model: only show runtime-cache-state in status when trustworthy
  const rawRuntimeCacheState = await readRuntimeCacheState(runtimeCacheStatePath(homeDir));
  const runtimeCacheStateTrustworthy = rawRuntimeCacheState !== undefined
    && isRuntimeCacheStateFresh(rawRuntimeCacheState)
    && isRuntimeCacheStatePidMatch(rawRuntimeCacheState, pidContent?.pid ?? -1)
    && supervisorLive;

  const data: GatewayStatusData = {
    channels: config.channels,
    cronJobs: cronJobs.map((j) => ({ status: j.status, name: j.name, nextRunAt: j.nextRunAt })),
    recentCronFailures,
    recentDeliveryErrors,
    surfacePointers,
    approvalCount: allApprovals.length,
    missingConfig,
    supervisor:
      state !== undefined
        ? {
            pid: pidContent?.pid ?? state.pid,
            lifecycle: state.lifecycle,
            startedAt: state.startedAt,
            version: state.version,
          }
        : pidContent !== undefined
          ? {
              pid: pidContent.pid,
              startedAt: pidContent.startedAt,
              version: pidContent.version,
            }
          : undefined,
    identityLocks,
    runtimeState: runtimeStateValid ? runtimeState : undefined,
    runtimeCacheState: runtimeCacheStateTrustworthy ? rawRuntimeCacheState : undefined,
  };

  const viewModel = buildGatewayStatusViewModel(data);
  return { ok: true, output: renderer(viewModel) };
}

// ─────────────────────────────────────────────────────────────
// Gateway Diagnose
// ─────────────────────────────────────────────────────────────

export async function runGatewayDiagnose(
  options: GatewayCommandOptions,
  renderer: GatewayRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const config = await loadRuntimeConfig(options);
  const homeDir = options.homeDir ?? process.env.HOME ?? ".estacoda";
  const stateRoot = join(homeDir, ".estacoda");

  const tgDiag = await getTelegramGatewayDiagnostics(options);
  const waDiag = await getWhatsAppGatewayDiagnostics({ homeDir });

  const cronStore = new CronStore({ homeDir });
  const cronJobs = await cronStore.list();
  const jobsFileReadable = await isReadable(cronStore.path);
  const outputDirWritable = await isWritable(join(stateRoot, "cron", "output"));
  const lockDirWritable = await isWritable(join(stateRoot, "cron", "locks"));

  const runtimeState = await readAdapterRuntimeState(homeDir);
  const pidContent = await readGatewayPid(homeDir);
  const supervisorLive = pidContent !== undefined && !(await isStalePid(homeDir));
  const runtimeStateNote = runtimeState === undefined
    ? undefined
    : !isRuntimeStateFresh(runtimeState)
      ? "stale"
      : !isRuntimeStatePidMatch(runtimeState, pidContent?.pid ?? -1)
        ? "pid-mismatch"
        : !supervisorLive
          ? "supervisor-not-live"
          : undefined;

  // Diagnose always reads runtime-cache-state; may display with warnings
  const rawRuntimeCacheState = await readRuntimeCacheState(runtimeCacheStatePath(homeDir));
  const runtimeCacheStateNote = rawRuntimeCacheState === undefined
    ? undefined
    : !isRuntimeCacheStateFresh(rawRuntimeCacheState)
      ? "stale"
      : !isRuntimeCacheStatePidMatch(rawRuntimeCacheState, pidContent?.pid ?? -1)
        ? "pid-mismatch"
        : !supervisorLive
          ? "supervisor-not-live"
          : undefined;

  const data: GatewayDiagnoseData = {
    telegram: tgDiag,
    discord: config.channels.discord,
    email: config.channels.email,
    whatsapp: waDiag,
    whatsappExperimental: config.channels.whatsapp.experimental ?? false,
    cronJobs: cronJobs.map((j) => ({ status: j.status })),
    jobsFileReadable,
    outputDirWritable,
    lockDirWritable,
    supervisor: {
      pidHealthy: !(await isStalePid(homeDir)),
      lockHealthy: !(await isStaleLock(homeDir)),
    },
    identityLockHealth: await buildIdentityLockHealth(homeDir, config.channels),
    runtimeState: runtimeState ?? undefined,
    runtimeStateNote,
    runtimeCacheState: rawRuntimeCacheState ?? undefined,
    runtimeCacheStateNote,
  };

  const viewModel = buildGatewayDiagnoseViewModel(data);
  return { ok: viewModel.ok, output: renderer(viewModel) };
}

// ───────────────────────────────────────────────────────────
// Gateway Stop
// ───────────────────────────────────────────────────────────

export async function runGatewayStop(
  options: GatewayCommandOptions & { force?: boolean }
): Promise<{ ok: boolean; output: string }> {
  const homeDir = options.homeDir ?? process.env.HOME ?? ".estacoda";
  const result = await stopGateway(homeDir, { force: options.force });

  if (result.ok) {
    if (result.action === "was_not_running") {
      if (result.liveLock) {
        return { ok: true, output: "Gateway is not running (live operation lock exists)" };
      }
      if (result.pid !== undefined) {
        return {
          ok: true,
          output: `Gateway was not running (cleaned up stale state for PID ${result.pid})`,
        };
      }
      return { ok: true, output: "Gateway is not running" };
    }

    // action === "stopped"
    if (result.forced) {
      return {
        ok: true,
        output: `Gateway stopped (forced, PID ${result.pid})`,
      };
    }
    return { ok: true, output: `Gateway stopped (PID ${result.pid})` };
  }

  return { ok: false, output: result.error };
}

// ───────────────────────────────────────────────────────────
// Channels List
// ───────────────────────────────────────────────────────────

export async function runChannelsList(
  options: GatewayCommandOptions,
  renderer: GatewayRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const config = await loadRuntimeConfig(options);
  const registry = new AdapterRegistry(config.channels);

  const viewModel = buildChannelsListViewModel({ channels: config.channels, capabilities: registry.all() });
  return { ok: true, output: renderer(viewModel) };
}

// ─────────────────────────────────────────────────────────────
// Channels Status
// ─────────────────────────────────────────────────────────────

export async function runChannelsStatus(
  options: GatewayCommandOptions & { channel?: string },
  renderer: GatewayRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const config = await loadRuntimeConfig(options);
  const homeDir = options.homeDir ?? process.env.HOME ?? ".estacoda";
  const stateRoot = join(homeDir, ".estacoda");

  const surfacePointerStore = new FileSurfacePointerStore({ path: join(stateRoot, "surface-pointers.json") });
  const surfacePointers = await surfacePointerStore.listPointers();

  const registry = new AdapterRegistry(config.channels);

  const channel = options.channel?.toLowerCase();

  if (channel === undefined || channel === "telegram") {
    const tgDiag = await getTelegramGatewayDiagnostics(options);
    const tgPointers = surfacePointers.filter((p) => p.surfaceType === "telegram");

    const data: ChannelsStatusData = {
      channel: "telegram",
      telegram: { diag: tgDiag, pointers: tgPointers, capability: registry.get("telegram")! },
    };
    const viewModel = buildChannelsStatusViewModel(data);
    return { ok: viewModel.kind !== "plainFallback", output: renderer(viewModel) };
  }

  if (channel === "discord") {
    const dcPointers = surfacePointers.filter((p) => p.surfaceType === "discord");

    const data: ChannelsStatusData = {
      channel: "discord",
      discord: { config: config.channels.discord, pointers: dcPointers, capability: registry.get("discord")! },
    };
    const viewModel = buildChannelsStatusViewModel(data);
    return { ok: true, output: renderer(viewModel) };
  }

  if (channel === "email") {
    const emPointers = surfacePointers.filter((p) => p.surfaceType === "email");

    const data: ChannelsStatusData = {
      channel: "email",
      email: { config: config.channels.email, pointers: emPointers, capability: registry.get("email")! },
    };
    const viewModel = buildChannelsStatusViewModel(data);
    return { ok: true, output: renderer(viewModel) };
  }

  if (channel === "whatsapp") {
    const waDiag = await getWhatsAppGatewayDiagnostics({ homeDir });
    const waPointers = surfacePointers.filter((p) => p.surfaceType === "whatsapp");

    const data: ChannelsStatusData = {
      channel: "whatsapp",
      whatsapp: { diag: waDiag, config: config.channels.whatsapp, pointers: waPointers, capability: registry.get("whatsapp")! },
    };
    const viewModel = buildChannelsStatusViewModel(data);
    return { ok: true, output: renderer(viewModel) };
  }

  const viewModel = buildChannelsStatusViewModel({ channel: options.channel ?? "unknown" });
  return { ok: false, output: renderer(viewModel) };
}

// ─────────────────────────────────────────────────────────────
// Identity Lock Helpers
// ─────────────────────────────────────────────────────────────

async function buildIdentityLockStatuses(
  homeDir: string,
  _channels: LoadedRuntimeConfig["channels"]
): Promise<IdentityLockStatus[]> {
  const locks = await listAdapterIdentityLocks(homeDir);
  const staleLocks = locks.filter((l) => l.stale);

  // Deduplicate by kind; status only surfaces actionable problems
  const seen = new Set<string>();
  const results: IdentityLockStatus[] = [];
  for (const lock of staleLocks) {
    if (!seen.has(lock.kind)) {
      seen.add(lock.kind);
      results.push({ kind: lock.kind, state: "stale", pid: lock.pid });
    }
  }
  return results;
}

async function buildIdentityLockHealth(
  homeDir: string,
  channels: LoadedRuntimeConfig["channels"]
): Promise<{
  staleLocks: { kind: string; pid: number }[];
  duplicateHashes: string[];
  missingLocks: string[];
}> {
  const [tgHash, dcHash, emHash, waHash] = await Promise.all([
    deriveTelegramIdentityHash(homeDir, channels.telegram),
    deriveDiscordIdentityHash(homeDir, channels.discord),
    deriveEmailIdentityHash(homeDir, channels.email),
    deriveWhatsAppIdentityHash(homeDir, channels.whatsapp),
  ]);

  const locks = await listAdapterIdentityLocks(homeDir);

  const staleLocks = locks
    .filter((l) => l.stale)
    .map((l) => ({ kind: l.kind, pid: l.pid }));

  const seenHashes = new Set<string>();
  const duplicateHashes: string[] = [];
  for (const lock of locks) {
    if (seenHashes.has(lock.identityHash)) {
      duplicateHashes.push(`${lock.kind}:${lock.identityHash.slice(0, 8)}...`);
    }
    seenHashes.add(lock.identityHash);
  }

  const missingLocks: string[] = [];
  const kindToHash = new Map<string, string | undefined>([
    ["telegram", tgHash],
    ["discord", dcHash],
    ["email", emHash],
    ["whatsapp", waHash],
  ]);
  for (const kind of ["telegram", "discord", "email", "whatsapp"] as const) {
    const hash = kindToHash.get(kind);
    if (hash === undefined) continue;
    const hasLock = locks.some((l) => l.kind === kind && l.identityHash === hash);
    if (!hasLock) {
      missingLocks.push(kind);
    }
  }

  return { staleLocks, duplicateHashes, missingLocks };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
