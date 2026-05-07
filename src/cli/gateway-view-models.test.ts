import { describe, it, expect } from "vitest";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import {
  buildGatewayStatusViewModel,
  buildGatewayDiagnoseViewModel,
  buildChannelsListViewModel,
} from "./gateway-view-models.js";
import type { GatewayStatusData, GatewayDiagnoseData } from "./gateway-view-models.js";

function baseStatusData(): GatewayStatusData {
  return {
    channels: {
      telegram: { enabled: true, ready: true, allowedUserIds: [], allowedChatIds: [], missing: undefined },
      discord: { enabled: false, ready: false, missing: undefined },
      email: { enabled: false, ready: false, missing: undefined },
      whatsapp: { enabled: false, ready: false, experimental: false, missing: undefined },
    },
    cronJobs: [],
    recentCronFailures: [],
    recentDeliveryErrors: [],
    surfacePointers: [],
    approvalCount: 0,
    missingConfig: [],
    identityLocks: [],
  };
}

function baseDiagnoseData(note?: GatewayDiagnoseData["runtimeStateNote"]): GatewayDiagnoseData {
  return {
    telegram: {
      adapter: "telegram",
      enabled: true,
      ready: true,
      statusLabel: "ok",
      modelRoute: "openai/gpt-4",
      contextWindowTokens: 8192,
      securityLabel: "allowlist",
      allowedUserIds: [],
      allowedChatIds: [],
      groupSessionsPerUser: true,
      threadSessionsPerUser: false,
      sessionResetPolicy: "none",
      botTokenEnv: "BOT_TOKEN",
      botTokenPresent: true,
      defaultChatId: "123",
      missing: [],
      processMode: "foreground",
      logsLocation: "stdout",
      stateRoot: "/tmp/.estacoda",
      sessionDbPath: "/tmp/.estacoda/sessions.sqlite",
      mediaRoot: "/tmp/.estacoda/channel-media",
      approvalStorePath: "/tmp/.estacoda/channel-approvals.json",
      sessionContextPath: "/tmp/.estacoda/channel-sessions.json",
      configSources: [],
    },
    discord: { enabled: false, ready: false, missing: undefined },
    email: { enabled: false, ready: false, missing: undefined },
    whatsapp: {
      adapter: "whatsapp",
      enabled: false,
      experimental: false,
      ready: false,
      statusLabel: "disabled",
      baileysAvailable: false,
      authDir: "/tmp/.estacoda/whatsapp-auth",
      authDirWritable: false,
      missing: [],
    },
    whatsappExperimental: false,
    cronJobs: [],
    jobsFileReadable: true,
    outputDirWritable: true,
    lockDirWritable: true,
    supervisor: { pidHealthy: true, lockHealthy: true },
    identityLockHealth: { staleLocks: [], duplicateHashes: [], missingLocks: [] },
    runtimeStateNote: note,
  };
}

describe("buildGatewayStatusViewModel", () => {
  it("renders without runtime state", () => {
    const data = baseStatusData();
    const vm = buildGatewayStatusViewModel(data);
    const rendered = renderPlain(vm);
    expect(rendered).toContain("EstaCoda gateway status");
    expect(rendered).not.toContain("Adapter Runtime");
  });

  it("renders with adapter runtime block when state is valid", () => {
    const data: GatewayStatusData = {
      ...baseStatusData(),
      runtimeState: {
        supervisorPid: 1234,
        supervisorStartedAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:01:00.000Z",
        adapters: [
          {
            kind: "telegram",
            state: "healthy",
            pollsTotal: 5,
            pollsFailed: 0,
            pollMessagesProcessed: 12,
          },
          {
            kind: "discord",
            state: "retry_scheduled",
            pendingOperation: "poll",
            pollsTotal: 3,
            pollsFailed: 2,
            pollMessagesProcessed: 0,
            retry: { attempt: 2, maxAttempts: 5, nextRetryAt: "2024-01-01T00:02:00.000Z" },
            lastError: { message: "network timeout", timestamp: "2024-01-01T00:01:00.000Z", count: 2 },
          },
        ],
      },
    };
    const vm = buildGatewayStatusViewModel(data);
    const rendered = renderPlain(vm);
    expect(rendered).toContain("Adapter Runtime");
    expect(rendered).toContain("telegram: healthy | polls=5 processed=12 failed=0");
    expect(rendered).toContain("discord: retry_scheduled");
    expect(rendered).toContain("retry 2/5 at 2024-01-01T00:02:00.000Z");
    expect(rendered).toContain("network timeout (x2)");
  });
});

describe("buildGatewayDiagnoseViewModel", () => {
  it("renders without runtime state notes when healthy", () => {
    const data = baseDiagnoseData();
    const vm = buildGatewayDiagnoseViewModel(data);
    const rendered = renderPlain(vm);
    expect(rendered).toContain("EstaCoda gateway diagnose");
    expect(rendered).not.toContain("Adapter Runtime");
  });

  it("renders stale runtime state warning", () => {
    const data = baseDiagnoseData("stale");
    const vm = buildGatewayDiagnoseViewModel(data);
    const rendered = renderPlain(vm);
    expect(rendered).toContain("[WARN] Adapter Runtime: runtime state is stale (supervisor may have crashed)");
  });

  it("renders pid-mismatch runtime state warning", () => {
    const data = baseDiagnoseData("pid-mismatch");
    const vm = buildGatewayDiagnoseViewModel(data);
    const rendered = renderPlain(vm);
    expect(rendered).toContain("[WARN] Adapter Runtime: runtime state PID does not match current supervisor PID");
  });
});

describe("buildChannelsListViewModel", () => {
  it("renders channel list", () => {
    const vm = buildChannelsListViewModel({
      channels: baseStatusData().channels,
      capabilities: [
        { kind: "telegram", enabled: true, configured: true, inboundMode: "websocket", outboundMode: "push", supportsAttachments: true, supportsThreads: true, supportsApprovals: false, supportsProgressStreaming: false, experimental: false, implementationStatus: "live_proven", missingConfig: undefined },
        { kind: "discord", enabled: false, configured: false, inboundMode: "websocket", outboundMode: "push", supportsAttachments: true, supportsThreads: true, supportsApprovals: false, supportsProgressStreaming: false, experimental: false, implementationStatus: "live_proven", missingConfig: undefined },
        { kind: "email", enabled: false, configured: false, inboundMode: "polling", outboundMode: "push", supportsAttachments: true, supportsThreads: false, supportsApprovals: false, supportsProgressStreaming: false, experimental: false, implementationStatus: "live_proven", missingConfig: undefined },
        { kind: "whatsapp", enabled: false, configured: false, inboundMode: "websocket", outboundMode: "push", supportsAttachments: true, supportsThreads: true, supportsApprovals: false, supportsProgressStreaming: false, experimental: true, implementationStatus: "present_not_live_proven", missingConfig: undefined },
      ],
    });
    const rendered = renderPlain(vm);
    expect(rendered).toContain("EstaCoda channels");
    expect(rendered).toContain("telegram");
    expect(rendered).toContain("discord");
  });
});
