import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { loadRuntimeConfig, consumeTelegramPairingCode } from "../config/runtime-config.js";
import type { ChannelAdapter, ChannelAuthPolicy, ChannelKind } from "../contracts/channel.js";
import { createRuntimeCronRunner, tickCron } from "../cron/cron-runner.js";
import { CronStore } from "../cron/cron-store.js";
import { CronExecutionStore } from "../cron/cron-execution-store.js";
import { createFileCronJobLock } from "../cron/cron-lock.js";
import { ProviderExecutor } from "../providers/provider-executor.js";
import { createRuntime } from "../runtime/create-runtime.js";
import { SQLiteSessionDB } from "../session/sqlite-session-db.js";
import { kemetBlueTheme } from "../theme/kemet-blue.js";
import { ChannelApprovalStore } from "../channels/channel-approval-store.js";
import { ChannelGateway, telegramGatewayCommands } from "../channels/channel-gateway.js";
import { PersistentChannelSessionStore } from "../channels/channel-session-store.js";
import { DeliveryRouter } from "../channels/delivery-router.js";
import { FileHandoffStore } from "../channels/handoff-store.js";
import { FileSurfacePointerStore } from "../channels/surface-pointer-store.js";
import { TelegramAdapter, type TelegramFetch } from "../channels/telegram-adapter.js";
import { DiscordAdapter } from "../channels/discord-adapter.js";
import { EmailAdapter } from "../channels/email-adapter.js";
import { WhatsAppAdapter } from "../channels/whatsapp-adapter.js";
import { AdapterRegistry } from "../channels/adapter-registry.js";
import {
  deriveTelegramIdentityHash,
  deriveDiscordIdentityHash,
  deriveEmailIdentityHash,
  deriveWhatsAppIdentityHash,
} from "../channels/adapter-identity.js";
import { injectVoiceTranscripts } from "../channels/voice-transcription.js";
import { acquireGatewayLock, releaseGatewayLock } from "./gateway-lock.js";
import { writeGatewayPid, removeGatewayPid } from "./pid-file.js";
import { writeGatewayState, removeGatewayState } from "./supervisor-state.js";
import { cleanupStaleGatewayState } from "./supervisor-state.js";
import {
  acquireAdapterIdentityLock,
  releaseAdapterIdentityLock,
} from "./identity-lock.js";
import { getPackageVersion } from "../cli/version-command.js";
import type { GatewayRunOptions, GatewayRunResult } from "../channels/gateway-runner.js";

export type { GatewayRunOptions, GatewayRunResult };

export type SupervisorFactories = {
  createTelegramAdapter?(input: ConstructorParameters<typeof TelegramAdapter>[0]): ChannelAdapter;
  createDiscordAdapter?(input: ConstructorParameters<typeof DiscordAdapter>[0]): ChannelAdapter;
  createEmailAdapter?(input: ConstructorParameters<typeof EmailAdapter>[0]): ChannelAdapter;
  createWhatsAppAdapter?(input: ConstructorParameters<typeof WhatsAppAdapter>[0]): ChannelAdapter;
  createChannelGateway?(input: ConstructorParameters<typeof ChannelGateway>[0]): ChannelGateway;
  createDeliveryRouter?(input: ConstructorParameters<typeof DeliveryRouter>[0]): DeliveryRouter;
  tickCron?(input: Parameters<typeof tickCron>[0]): ReturnType<typeof tickCron>;
  sleep?(ms: number): Promise<void>;
  exit?(code: number): void;
};

export type GatewaySupervisorOptions = GatewayRunOptions & {
  once?: boolean;
  factories?: SupervisorFactories;
};

type AcquiredIdentityLock = {
  kind: ChannelKind;
  hash: string;
};

type SupervisorInternalState = {
  homeDir: string;
  gatewayLockAcquired: boolean;
  acquiredIdentityLocks: AcquiredIdentityLock[];
  channelGateway: ChannelGateway | undefined;
  sessionDb: SQLiteSessionDB | undefined;
  onSigint: (() => void) | undefined;
  onSigterm: (() => void) | undefined;
  shutdownStarted: boolean;
  running: boolean;
  exit: (code: number) => void;
};

function logInfo(message: string): void {
  console.log(message);
}

function logWarning(message: string): void {
  console.warn(message);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createInitialState(homeDir: string, exitFn: (code: number) => void): SupervisorInternalState {
  return {
    homeDir,
    gatewayLockAcquired: false,
    acquiredIdentityLocks: [],
    channelGateway: undefined,
    sessionDb: undefined,
    onSigint: undefined,
    onSigterm: undefined,
    shutdownStarted: false,
    running: true,
    exit: exitFn,
  };
}

async function cleanupSupervisorStartupResources(state: SupervisorInternalState): Promise<void> {
  // 1. Stop ChannelGateway if it was started
  if (state.channelGateway !== undefined) {
    try { await state.channelGateway.stop(); } catch { /* ignore */ }
  }

  // 2. Close session DB if opened
  if (state.sessionDb !== undefined) {
    try { state.sessionDb.close(); } catch { /* ignore */ }
  }

  // 3. Release identity locks in reverse acquisition order
  for (let i = state.acquiredIdentityLocks.length - 1; i >= 0; i--) {
    const { kind, hash } = state.acquiredIdentityLocks[i];
    try {
      const result = await releaseAdapterIdentityLock(state.homeDir, kind, hash, process.pid);
      if (!result.released && result.reason === "not_owner") {
        logWarning(`Cannot release ${kind} identity lock: not owner`);
      }
    } catch { /* ignore */ }
  }

  // 4. Remove PID and state files
  try { await removeGatewayPid(state.homeDir); } catch { /* ignore */ }
  try { await removeGatewayState(state.homeDir); } catch { /* ignore */ }

  // 5. Release gateway lock ONLY if we acquired it
  if (state.gatewayLockAcquired) {
    try { await releaseGatewayLock(state.homeDir); } catch { /* ignore */ }
  }

  // 6. Remove signal handlers so they do not accumulate across tests or invocations
  if (state.onSigint !== undefined) {
    try { process.off("SIGINT", state.onSigint); } catch { /* ignore */ }
  }
  if (state.onSigterm !== undefined) {
    try { process.off("SIGTERM", state.onSigterm); } catch { /* ignore */ }
  }
}

export async function runGatewaySupervisor(options: GatewaySupervisorOptions): Promise<GatewayRunResult> {
  const config = await loadRuntimeConfig(options);
  const version = await getPackageVersion();
  const homeDir = options.homeDir ?? process.env.HOME ?? process.cwd();
  const stateRoot = join(homeDir, ".estacoda");

  const state = createInitialState(homeDir, options.factories?.exit ?? ((code: number) => process.exit(code)));

  // 1. Stale state cleanup
  const staleCleanup = await cleanupStaleGatewayState(homeDir);
  if (staleCleanup.cleaned && staleCleanup.reason !== undefined) {
    logInfo(`Cleaned up stale state: ${staleCleanup.reason}`);
  }

  // 2. Gateway lock acquisition
  const lockResult = await acquireGatewayLock(homeDir);
  if (!lockResult.acquired) {
    return {
      ok: false,
      output: "Gateway already running (lock held)",
      polls: 0,
      processed: 0,
    };
  }
  state.gatewayLockAcquired = true;

  // 3. PID / state write
  const startedAt = new Date().toISOString();
  await writeGatewayPid(homeDir, { pid: process.pid, startedAt, version });
  await writeGatewayState(homeDir, { lifecycle: "running", startedAt, pid: process.pid, version });

  // 4. Signal handlers (installed EARLY)
  const shutdown = (signalName?: string) => {
    if (state.shutdownStarted) {
      logWarning("Forced exit on second signal");
      state.exit(1);
      return;
    }
    state.shutdownStarted = true;
    state.running = false;
    logInfo(`Shutting down${signalName ? ` (${signalName})` : ""}...`);
    cleanupSupervisorStartupResources(state).then(() => {
      state.exit(0);
    });
  };

  state.onSigint = () => shutdown("SIGINT");
  state.onSigterm = () => shutdown("SIGTERM");
  process.on("SIGINT", state.onSigint);
  process.on("SIGTERM", state.onSigterm);

  try {
    // 5. Adapter capability scan
    const registry = new AdapterRegistry(config.channels);
    const configured = registry.configured();

    if (configured.length === 0) {
      logInfo("Adapters: none");
      logInfo("Mode: cron-only");
    }

    // 6. Identity derivation + lock acquisition per adapter
    for (const cap of configured) {
      let hash: string | undefined;
      switch (cap.kind) {
        case "telegram":
          hash = await deriveTelegramIdentityHash(homeDir, config.channels.telegram);
          break;
        case "discord":
          hash = await deriveDiscordIdentityHash(homeDir, config.channels.discord);
          break;
        case "email":
          hash = await deriveEmailIdentityHash(homeDir, config.channels.email);
          break;
        case "whatsapp":
          hash = await deriveWhatsAppIdentityHash(homeDir, config.channels.whatsapp);
          break;
        default:
          break;
      }

      if (hash === undefined) {
        await cleanupSupervisorStartupResources(state);
        return {
          ok: false,
          output: `${cap.kind}: configured but no derivable identity. Check config.`,
          polls: 0,
          processed: 0,
        };
      }

      const identityResult = await acquireAdapterIdentityLock(homeDir, cap.kind, hash);
      if (!identityResult.acquired) {
        await cleanupSupervisorStartupResources(state);
        return {
          ok: false,
          output: `${cap.kind} identity already locked by PID ${identityResult.holderPid ?? "unknown"}`,
          polls: 0,
          processed: 0,
        };
      }

      state.acquiredIdentityLocks.push({ kind: cap.kind, hash });
    }

    // 7. Shared infrastructure
    const sessionDbPath = join(stateRoot, "sessions.sqlite");
    const mediaRoot = join(stateRoot, "channel-media");
    const approvalStorePath = join(stateRoot, "channel-approvals.json");
    const sessionContextPath = join(stateRoot, "channel-sessions.json");
    await mkdir(dirname(sessionDbPath), { recursive: true });
    const sessionDb = new SQLiteSessionDB({ path: sessionDbPath });
    state.sessionDb = sessionDb;

    const cronStore = new CronStore({ homeDir });
    const cronExecutionStore = new CronExecutionStore(sessionDb.db);
    const cronJobLock = createFileCronJobLock({
      lockDir: join(stateRoot, "cron", "locks"),
      staleTimeoutMs: 600_000,
    });

    const approvalStore = new ChannelApprovalStore({ path: approvalStorePath });
    const handoffStore = new FileHandoffStore({ path: join(stateRoot, "handoff-codes.json") });
    const surfacePointerStore = new FileSurfacePointerStore({ path: join(stateRoot, "surface-pointers.json") });

    // 8. Adapter instantiation
    const adapters: ChannelAdapter[] = [];
    const router = options.factories?.createDeliveryRouter
      ? options.factories.createDeliveryRouter({ homeDir: options.homeDir })
      : new DeliveryRouter({ homeDir: options.homeDir });

    for (const cap of configured) {
      let adapter: ChannelAdapter;
      switch (cap.kind) {
        case "telegram": {
          const telegram = config.channels.telegram;
          const botTokenEnv = telegram.botTokenEnv;
          const botToken = botTokenEnv === undefined ? undefined : process.env[botTokenEnv];
          const telegramAuthPolicy = (allowedUserIds: string[], allowedChatIds: string[]): ChannelAuthPolicy => {
            if (allowedUserIds.length === 0 && allowedChatIds.length === 0) {
              return {
                mode: "allowlist",
                allowedUserIds: [],
                allowedChatIds: [],
                deniedMessage: "This EstaCoda Telegram bot is locked. Add your Telegram user ID or chat ID to the allowlist before chatting with it."
              };
            }
            return {
              mode: "allowlist",
              allowedUserIds,
              allowedChatIds,
              deniedMessage: "This EstaCoda Telegram bot is not paired with this account. Ask the owner to add your Telegram user ID or chat ID."
            };
          };
          adapter = options.factories?.createTelegramAdapter
            ? options.factories.createTelegramAdapter({
                botToken: botToken!,
                defaultChatId: telegram.defaultChatId,
                pollTimeoutSeconds: telegram.pollTimeoutSeconds,
                maxAttachmentBytes: telegram.maxAttachmentBytes,
                mediaRoot,
                activityLabelsLocale: config.ui.activityLabels,
                fetch: options.telegramFetch,
              })
            : new TelegramAdapter({
                botToken: botToken!,
                defaultChatId: telegram.defaultChatId,
                pollTimeoutSeconds: telegram.pollTimeoutSeconds,
                maxAttachmentBytes: telegram.maxAttachmentBytes,
                mediaRoot,
                activityLabelsLocale: config.ui.activityLabels,
                fetch: options.telegramFetch,
              });
          router.registerAdapter(adapter);
          adapters.push(adapter);
          break;
        }
        case "discord": {
          const discord = config.channels.discord;
          const botTokenEnv = discord.botTokenEnv;
          const botToken = botTokenEnv === undefined ? undefined : process.env[botTokenEnv];
          adapter = options.factories?.createDiscordAdapter
            ? options.factories.createDiscordAdapter({
                botToken: botToken!,
                allowedUsers: discord.allowedUsers,
                allowedGuilds: discord.allowedGuilds,
                allowedChannels: discord.allowedChannels,
                freeResponseChannels: discord.freeResponseChannels,
                mediaRoot,
              })
            : new DiscordAdapter({
                botToken: botToken!,
                allowedUsers: discord.allowedUsers,
                allowedGuilds: discord.allowedGuilds,
                allowedChannels: discord.allowedChannels,
                freeResponseChannels: discord.freeResponseChannels,
                mediaRoot,
              });
          router.registerAdapter(adapter);
          adapters.push(adapter);
          break;
        }
        case "email": {
          const email = config.channels.email;
          const password = email.passwordEnv ? process.env[email.passwordEnv] : undefined;
          adapter = options.factories?.createEmailAdapter
            ? options.factories.createEmailAdapter({
                imapHost: email.imapHost ?? "imap.gmail.com",
                imapPort: email.imapPort ?? 993,
                smtpHost: email.smtpHost ?? "smtp.gmail.com",
                smtpPort: email.smtpPort ?? 465,
                username: email.username!,
                password: password!,
                ownAddress: email.ownAddress ?? email.username!,
                homeAddress: email.homeAddress,
                allowedSenders: email.allowedSenders,
                allowAllUsers: email.allowAllUsers,
                pollIntervalSeconds: email.pollIntervalSeconds ?? 60,
                mediaRoot,
                markAllSeenOnConnect: true,
              })
            : new EmailAdapter({
                imapHost: email.imapHost ?? "imap.gmail.com",
                imapPort: email.imapPort ?? 993,
                smtpHost: email.smtpHost ?? "smtp.gmail.com",
                smtpPort: email.smtpPort ?? 465,
                username: email.username!,
                password: password!,
                ownAddress: email.ownAddress ?? email.username!,
                homeAddress: email.homeAddress,
                allowedSenders: email.allowedSenders,
                allowAllUsers: email.allowAllUsers,
                pollIntervalSeconds: email.pollIntervalSeconds ?? 60,
                mediaRoot,
                markAllSeenOnConnect: true,
              });
          router.registerAdapter(adapter);
          adapters.push(adapter);
          break;
        }
        case "whatsapp": {
          const whatsapp = config.channels.whatsapp;
          const authDir = join(stateRoot, "whatsapp-auth");
          adapter = options.factories?.createWhatsAppAdapter
            ? options.factories.createWhatsAppAdapter({
                authDir,
                allowedUsers: whatsapp.allowedUsers,
                pairingMode: whatsapp.pairingMode ?? "qr",
                pairingCodePhoneNumber: whatsapp.pairingCodePhoneNumber,
                mediaRoot,
              })
            : new WhatsAppAdapter({
                authDir,
                allowedUsers: whatsapp.allowedUsers,
                pairingMode: whatsapp.pairingMode ?? "qr",
                pairingCodePhoneNumber: whatsapp.pairingCodePhoneNumber,
                mediaRoot,
              });
          router.registerAdapter(adapter);
          adapters.push(adapter);
          break;
        }
        default:
          break;
      }
    }

    // 9. Build ChannelGateway
    const telegram = config.channels.telegram;
    const authPolicy = telegram.enabled === true
      ? (() => {
          const allowedUserIds = telegram.allowedUserIds ?? [];
          const allowedChatIds = telegram.allowedChatIds ?? [];
          if (allowedUserIds.length === 0 && allowedChatIds.length === 0) {
            return {
              mode: "allowlist" as const,
              allowedUserIds: [],
              allowedChatIds: [],
              deniedMessage: "This EstaCoda Telegram bot is locked. Add your Telegram user ID or chat ID to the allowlist before chatting with it."
            };
          }
          return {
            mode: "allowlist" as const,
            allowedUserIds,
            allowedChatIds,
            deniedMessage: "This EstaCoda Telegram bot is not paired with this account. Ask the owner to add your Telegram user ID or chat ID."
          };
        })()
      : { mode: "allow-all" as const };

    const sessionPolicy = {
      groupSessionsPerUser: telegram.groupSessionsPerUser ?? true,
      threadSessionsPerUser: telegram.threadSessionsPerUser ?? false,
      resetPolicy: telegram.sessionResetPolicy ?? "none",
      idleResetMinutes: telegram.sessionIdleResetMinutes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    const gateway = options.factories?.createChannelGateway
      ? options.factories.createChannelGateway({
          adapters,
          deliveryRouter: router,
          sessionStore: new PersistentChannelSessionStore({ path: sessionContextPath, policy: sessionPolicy, surfacePointerStore }),
          approvalStore,
          authPolicy,
          trustedWorkspace: true,
          sessionPolicy,
          handoffStore,
          surfacePointerStore,
          preprocessMessage: async (message) => {
            const latestConfig = await loadRuntimeConfig(options);
            return injectVoiceTranscripts(message, { stt: latestConfig.stt });
          },
          pair: async (message) => {
            const result = await consumeTelegramPairingCode({
              workspaceRoot: options.workspaceRoot,
              homeDir: options.homeDir,
              userConfigPath: options.userConfigPath,
              projectConfigPath: options.projectConfigPath,
              code: message.text,
              userId: message.sender.id,
              chatId: message.sessionKey.chatId,
            });
            if (!result.paired) return undefined;
            return "Telegram paired. This chat can now talk to EstaCoda.";
          },
          runtimeForSession: async ({ sessionId, securityPolicy, metadata }) => {
            const latestConfig = await loadRuntimeConfig(options);
            return createRuntime({
              theme: kemetBlueTheme,
              model: latestConfig.model,
              workspaceRoot: options.workspaceRoot,
              homeDir: options.homeDir,
              userConfigPath: options.userConfigPath,
              projectConfigPath: options.projectConfigPath,
              sessionId,
              profileId: "default",
              sessionDb,
              sessionMetadata: metadata,
              externalSkillRoots: latestConfig.skills.externalDirs,
              skillAutonomy: latestConfig.skills.autonomy,
              skillConfig: latestConfig.skills.config,
              ui: latestConfig.ui,
              agentProfile: latestConfig.profile,
              providerRegistry: latestConfig.providerRegistry,
              credentialPools: latestConfig.credentialPools,
              auxiliaryProviders: latestConfig.auxiliaryProviders,
              mcpServers: latestConfig.mcp.servers,
              securityPolicy,
              browser: latestConfig.browser,
              imageGen: latestConfig.imageGen,
              tts: latestConfig.tts,
              stt: latestConfig.stt,
              telegramReady: latestConfig.channels.telegram.ready,
              enableWebNetwork: latestConfig.web.enableNetwork,
              webMaxContentChars: latestConfig.web.maxContentChars,
            });
          },
        })
      : new ChannelGateway({
          adapters,
          deliveryRouter: router,
          sessionStore: new PersistentChannelSessionStore({ path: sessionContextPath, policy: sessionPolicy, surfacePointerStore }),
          approvalStore,
          authPolicy,
          trustedWorkspace: true,
          sessionPolicy,
          handoffStore,
          surfacePointerStore,
          preprocessMessage: async (message) => {
            const latestConfig = await loadRuntimeConfig(options);
            return injectVoiceTranscripts(message, { stt: latestConfig.stt });
          },
          pair: async (message) => {
            const result = await consumeTelegramPairingCode({
              workspaceRoot: options.workspaceRoot,
              homeDir: options.homeDir,
              userConfigPath: options.userConfigPath,
              projectConfigPath: options.projectConfigPath,
              code: message.text,
              userId: message.sender.id,
              chatId: message.sessionKey.chatId,
            });
            if (!result.paired) return undefined;
            return "Telegram paired. This chat can now talk to EstaCoda.";
          },
          runtimeForSession: async ({ sessionId, securityPolicy, metadata }) => {
            const latestConfig = await loadRuntimeConfig(options);
            return createRuntime({
              theme: kemetBlueTheme,
              model: latestConfig.model,
              workspaceRoot: options.workspaceRoot,
              homeDir: options.homeDir,
              userConfigPath: options.userConfigPath,
              projectConfigPath: options.projectConfigPath,
              sessionId,
              profileId: "default",
              sessionDb,
              sessionMetadata: metadata,
              externalSkillRoots: latestConfig.skills.externalDirs,
              skillAutonomy: latestConfig.skills.autonomy,
              skillConfig: latestConfig.skills.config,
              ui: latestConfig.ui,
              agentProfile: latestConfig.profile,
              providerRegistry: latestConfig.providerRegistry,
              credentialPools: latestConfig.credentialPools,
              auxiliaryProviders: latestConfig.auxiliaryProviders,
              mcpServers: latestConfig.mcp.servers,
              securityPolicy,
              browser: latestConfig.browser,
              imageGen: latestConfig.imageGen,
              tts: latestConfig.tts,
              stt: latestConfig.stt,
              telegramReady: latestConfig.channels.telegram.ready,
              enableWebNetwork: latestConfig.web.enableNetwork,
              webMaxContentChars: latestConfig.web.maxContentChars,
            });
          },
        });

    state.channelGateway = gateway;

    // 10. Start adapters
    await gateway.start();

    for (const adapter of adapters) {
      if (adapter.kind === "telegram") {
        await (adapter as TelegramAdapter).setCommands(telegramGatewayCommands());
      }
    }

    if (configured.length > 0) {
      logInfo(`Started ${configured.length} adapter(s): ${configured.map((c) => c.kind).join(", ")}`);
    }

    // 11. Main loop
    let polls = 0;
    let processed = 0;
    const pollIntervalMs = 1000;
    const doSleep = options.factories?.sleep ?? sleep;
    const doTickCron = options.factories?.tickCron ?? tickCron;

    do {
      await doTickCron({
        store: cronStore,
        executionStore: cronExecutionStore,
        jobLock: cronJobLock,
        runner: createRuntimeCronRunner({
          deliver: async (job, content) => {
            const originKey = job.origin?.channel === "telegram" && job.origin.chatId !== undefined
              ? {
                  platform: "telegram" as const,
                  chatId: job.origin.chatId,
                  userId: job.origin.userId,
                  threadId: job.origin.threadId,
                }
              : undefined;
            const fallbackSessionKey = originKey ?? {
              platform: "telegram" as const,
              chatId: job.origin?.chatId ?? "cron",
            };
            const target = job.delivery ?? "local";
            const targets = router.parseTarget(target, fallbackSessionKey);
            const results = await router.deliverText(targets, content);
            return {
              success: Array.from(results.values()).some((r) => r.success),
              perTarget: results,
            };
          },
          disposeRuntime: true,
          workspaceRoot: options.workspaceRoot,
          runtimeFactory: async (job) => {
            const latestConfig = await loadRuntimeConfig(options);
            return createRuntime({
              theme: kemetBlueTheme,
              model: latestConfig.model,
              workspaceRoot: options.workspaceRoot,
              homeDir: options.homeDir,
              userConfigPath: options.userConfigPath,
              projectConfigPath: options.projectConfigPath,
              sessionId: `cron-${job.id}-${randomUUID()}`,
              profileId: "default",
              sessionDb,
              externalSkillRoots: latestConfig.skills.externalDirs,
              skillAutonomy: latestConfig.skills.autonomy,
              skillConfig: latestConfig.skills.config,
              ui: latestConfig.ui,
              agentProfile: latestConfig.profile,
              providerRegistry: latestConfig.providerRegistry,
              credentialPools: latestConfig.credentialPools,
              auxiliaryProviders: latestConfig.auxiliaryProviders,
              mcpServers: latestConfig.mcp.servers,
              imageGen: latestConfig.imageGen,
              tts: latestConfig.tts,
              stt: latestConfig.stt,
              securityMode: latestConfig.security.approvalMode,
              securityAssessor: {
                ...latestConfig.security.assessor,
                providerExecutor: new ProviderExecutor({
                  registry: latestConfig.providerRegistry,
                  credentialPools: latestConfig.credentialPools,
                }),
              },
              browser: latestConfig.browser,
              telegramReady: latestConfig.channels.telegram.ready,
              enableWebNetwork: latestConfig.web.enableNetwork,
              webMaxContentChars: latestConfig.web.maxContentChars,
              disableCronTools: true,
              disabledToolsets: ["cron", "messaging", "clarify"],
            });
          },
        }),
      });

      for (const adapter of adapters) {
        if (adapter.kind === "telegram" || adapter.kind === "email") {
          try {
            const count = await (adapter as TelegramAdapter | EmailAdapter).pollOnce();
            processed += count;
          } catch (err) {
            logWarning(`Adapter ${adapter.kind} pollOnce() error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      polls += 1;

      if (options.once === true) {
        state.running = false;
        break;
      }

      if (state.running) {
        await doSleep(pollIntervalMs);
      }
    } while (state.running);

    // 12. Shutdown
    await cleanupSupervisorStartupResources(state);

    return {
      ok: true,
      output: `Gateway stopped`,
      polls,
      processed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await cleanupSupervisorStartupResources(state);
    return {
      ok: false,
      output: `Startup failed: ${message}`,
      polls: 0,
      processed: 0,
    };
  }
}
