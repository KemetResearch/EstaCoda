import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createTelegramPairingCode,
  loadRuntimeConfig,
  setupBrowserConfig,
  setupProviderConfig,
  setupTelegramConfig,
  setupWebConfig,
  type BrowserSetupInput,
  type ProviderSetupInput,
  type TelegramSetupInput,
  type WebSetupInput
} from "../config/runtime-config.js";
import { runInteractiveOnboarding, type Prompt } from "../onboarding/interactive-onboarding.js";
import { getOnboardingStatus } from "../onboarding/onboarding-flow.js";
import type { ToolDefinition } from "../contracts/tool.js";
import type { FetchLike as ProviderFetchLike } from "../providers/openai-compatible-provider.js";
import {
  diagnoseProviderConfig,
  diagnoseProviderLive,
  renderProviderDiagnostic,
  renderProviderLiveDiagnostic
} from "../config/provider-diagnostics.js";
import { getTelegramGatewayDiagnostics, runTelegramGateway } from "../channels/gateway-runner.js";
import type { TelegramFetch } from "../channels/telegram-adapter.js";
import type { Runtime } from "../runtime/create-runtime.js";

export type CliCommandResult = {
  handled: boolean;
  exitCode: number;
  output: string;
};

export type CliOptions = {
  argv: string[];
  workspaceRoot: string;
  homeDir?: string;
  userConfigPath?: string;
  projectConfigPath?: string;
  tools?: ToolDefinition[];
  prompt?: Prompt;
  telegramFetch?: TelegramFetch;
  providerFetch?: ProviderFetchLike;
  runtime?: Runtime;
};

export async function runCliCommand(options: CliOptions): Promise<CliCommandResult> {
  const [command, ...args] = options.argv;

  switch (command) {
    case "setup":
      return setup(options, args);
    case "web":
      return web(options, args);
    case "browser":
      return browser(options, args);
    case "telegram":
      return telegram(options, args);
    case "gateway":
      return gateway(options, args);
    case "model":
      return model(options);
    case "tools":
      return tools(options);
    case "doctor":
      return doctor(options, args);
    case "help":
    case "--help":
    case "-h":
      return {
        handled: true,
        exitCode: 0,
        output: help()
      };
    default:
      return {
        handled: false,
        exitCode: 0,
        output: ""
      };
  }
}

async function setup(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const parsed = parseSetupArgs(args);

  if (hasFlag(args, "--interactive", "-i")) {
    const result = await runInteractiveOnboarding({
      ...options,
      prompt: options.prompt
    });

    return {
      handled: true,
      exitCode: result.exitCode,
      output: result.output
    };
  }

  if (parsed.provider === undefined || parsed.model === undefined) {
    const onboarding = await getOnboardingStatus(options);
    return {
      handled: true,
      exitCode: 0,
      output: [
        "EstaCoda setup",
        onboarding.reason,
        "",
        "Run:",
        "  estacoda setup --provider deepseek --model deepseek-chat --api-key-env DEEPSEEK_API_KEY",
        "",
        "Provider options:",
        ...onboarding.steps.flatMap((step) =>
          step.id === "provider"
            ? step.options.map((option) => `  ${formatProviderModel(option.provider, option.model)} - ${option.label}`)
            : []
        )
      ].join("\n")
    };
  }

  const result = await setupProviderConfig({
    ...options,
    input: parsed as ProviderSetupInput
  });
  const loaded = await loadRuntimeConfig(options);
  const diagnostic = await diagnoseProviderConfig(loaded);

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Configured ${parsed.provider}/${parsed.model}.`,
      `Config: ${result.path}`,
      result.envExport === undefined ? undefined : `Shell export:\n${result.envExport}`,
      "",
      "Setup check",
      renderProviderDiagnostic(diagnostic),
      diagnostic.status === "ready" ? "Ready: start EstaCoda and send your first prompt." : "Next: fix the warnings above, then run estacoda doctor."
    ].filter((line) => line !== undefined).join("\n")
  };
}

function formatProviderModel(provider: string, model: string): string {
  return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}

async function model(options: CliOptions): Promise<CliCommandResult> {
  const config = await loadRuntimeConfig(options);
  const diagnostic = await diagnoseProviderConfig(config);

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Current model: ${config.model.provider}/${config.model.id}`,
      `Context window: ${config.model.contextWindowTokens} tokens`,
      `Tools: ${config.model.supportsTools ? "yes" : "no"}`,
      `Vision: ${config.model.supportsVision ? "yes" : "no"}`,
      `Structured output: ${config.model.supportsStructuredOutput ? "yes" : "no"}`,
      `Web extraction: ${config.web.enableNetwork ? "enabled" : "disabled"}`,
      `Browser backend: ${config.browser.backend}`,
      `Config sources: ${config.sources.join(", ") || "none"}`,
      "",
      renderProviderDiagnostic(diagnostic)
    ].join("\n")
  };
}

async function tools(options: CliOptions): Promise<CliCommandResult> {
  const tools = options.tools ?? [];
  const grouped = new Map<string, string[]>();

  for (const tool of tools) {
    for (const toolset of tool.toolsets) {
      grouped.set(toolset, [...(grouped.get(toolset) ?? []), tool.name]);
    }
  }

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Tools: ${tools.length}`,
      ...[...grouped.entries()].map(([toolset, names]) => `${toolset}: ${names.join(", ")}`)
    ].join("\n")
  };
}

async function doctor(options: CliOptions, args: string[] = []): Promise<CliCommandResult> {
  const config = await loadRuntimeConfig(options);
  const onboarding = await getOnboardingStatus(options);
  const providerDiagnostic = await diagnoseProviderConfig(config);
  const liveProviderDiagnostic = hasFlag(args, "--live")
    ? await diagnoseProviderLive(config)
    : undefined;
  const liveToolDiagnostic = hasFlag(args, "--live-tools", "--live-tool")
    ? await diagnoseLiveToolCall({
        runtime: options.runtime,
        workspaceRoot: options.workspaceRoot
      })
    : undefined;
  const warnings = [];

  if (config.model.contextWindowTokens > 0 && config.model.contextWindowTokens < 64_000) {
    warnings.push("Configured model context window is below 64K tokens.");
  }

  if (onboarding.needed) {
    warnings.push("Provider setup is incomplete.");
  }

  warnings.push(...providerDiagnostic.warnings);
  warnings.push(...(liveProviderDiagnostic?.warnings ?? []));
  warnings.push(...(liveToolDiagnostic?.warnings ?? []));

  return {
    handled: true,
    exitCode: warnings.length === 0 &&
      liveProviderDiagnostic?.status !== "blocked" &&
      liveToolDiagnostic?.status !== "blocked"
      ? 0
      : 1,
    output: [
      "EstaCoda doctor",
      `Model: ${config.model.provider}/${config.model.id}`,
      `Web extraction: ${config.web.enableNetwork ? "enabled" : "disabled"}`,
      `Browser backend: ${config.browser.backend}`,
      `Config sources: ${config.sources.join(", ") || "none"}`,
      `Credential pools: ${config.credentialPools.snapshots().map((snapshot) => `${snapshot.provider}:${snapshot.entries.length}`).join(", ") || "none"}`,
      "",
      renderProviderDiagnostic(providerDiagnostic),
      liveProviderDiagnostic === undefined ? undefined : "",
      liveProviderDiagnostic === undefined ? undefined : renderProviderLiveDiagnostic(liveProviderDiagnostic),
      liveToolDiagnostic === undefined ? undefined : "",
      liveToolDiagnostic === undefined ? undefined : renderLiveToolDiagnostic(liveToolDiagnostic),
      "",
      warnings.length === 0 ? "Status: ready" : `Warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    ].filter((line) => line !== undefined).join("\n")
  };
}

type LiveToolDiagnostic = {
  status: "ready" | "blocked";
  lines: string[];
  warnings: string[];
};

async function diagnoseLiveToolCall(input: {
  runtime: Runtime | undefined;
  workspaceRoot: string;
}): Promise<LiveToolDiagnostic> {
  if (input.runtime === undefined) {
    return {
      status: "blocked",
      lines: ["Live tool check: skipped"],
      warnings: ["Runtime was not provided to the doctor command."]
    };
  }

  const doctorDir = join(input.workspaceRoot, ".estacoda", "doctor");
  const probePath = join(doctorDir, "live-tool-smoke.ts");
  const relativeProbePath = ".estacoda/doctor/live-tool-smoke.ts";
  const expectedName = "estacodaDoctorToolSmoke";
  const expectedValue = "live-tool-ok";

  await mkdir(doctorDir, { recursive: true });
  await writeFile(probePath, `export const ${expectedName} = '${expectedValue}';\n`, "utf8");

  try {
    const response = await input.runtime.handle({
      text: `Use the file.read tool to read ${relativeProbePath}, then tell me the exported constant name and value.`,
      channel: "cli",
      trustedWorkspace: true
    });
    const fileRead = response.toolExecutions.find((execution) => execution.tool.name === "file.read");
    const usedProviderToolCall = response.providerExecution?.toolCalls.some((toolCall) =>
      toolCall.name === "file_read" || toolCall.name === "file.read"
    ) === true;
    const finalAnswerIncludedProbe = response.text.includes(expectedName) && response.text.includes(expectedValue);
    const warnings: string[] = [];

    if (response.providerExecution?.ok !== true) {
      warnings.push("Provider did not complete successfully during the live tool check.");
    }

    if (!usedProviderToolCall) {
      warnings.push("Provider did not request the file_read tool.");
    }

    if (fileRead?.result?.ok !== true) {
      warnings.push("file.read did not execute successfully during the live tool check.");
    }

    if (!finalAnswerIncludedProbe) {
      warnings.push("Final provider answer did not include the probe constant name and value.");
    }

    return {
      status: warnings.length === 0 ? "ready" : "blocked",
      lines: [
        `Live tool check: ${warnings.length === 0 ? "ready" : "blocked"}`,
        `Probe file: ${relativeProbePath}`,
        `Provider: ${response.providerExecution?.response?.provider ?? "unknown"}/${response.providerExecution?.response?.model ?? "unknown"}`,
        `Provider requested file_read: ${usedProviderToolCall ? "yes" : "no"}`,
        `file.read executed: ${fileRead?.result?.ok === true ? "yes" : "no"}`,
        `Final answer used tool result: ${finalAnswerIncludedProbe ? "yes" : "no"}`
      ],
      warnings
    };
  } finally {
    await rm(probePath, { force: true });
  }
}

function renderLiveToolDiagnostic(diagnostic: LiveToolDiagnostic): string {
  return [
    ...diagnostic.lines,
    diagnostic.warnings.length === 0
      ? "Live tool status: ready"
      : `Live tool warnings:\n${diagnostic.warnings.map((warning) => `- ${warning}`).join("\n")}`
  ].join("\n");
}

async function browser(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand] = args;

  if (subcommand !== "status" && subcommand !== "configure" && subcommand !== "disable") {
    return {
      handled: true,
      exitCode: 0,
      output: [
        "EstaCoda browser backend",
        "  estacoda browser status",
        "  estacoda browser configure --backend local-cdp --cdp-url http://127.0.0.1:9222",
        "  estacoda browser disable"
      ].join("\n")
    };
  }

  if (subcommand === "status") {
    const config = await loadRuntimeConfig(options);
    return {
      handled: true,
      exitCode: 0,
      output: [
        `Browser backend: ${config.browser.backend}`,
        config.browser.cdpUrl === undefined ? undefined : `CDP URL: ${config.browser.cdpUrl}`,
        config.browser.launchCommand === undefined ? undefined : `Launch command: ${config.browser.launchCommand}`,
        `Auto-launch: ${config.browser.autoLaunch ? "enabled" : "disabled"}`,
        `Config sources: ${config.sources.join(", ") || "none"}`
      ].filter((line) => line !== undefined).join("\n")
    };
  }

  const parsed = subcommand === "disable"
    ? { backend: "unconfigured" as const }
    : parseBrowserArgs(args.slice(1));
  const result = await setupBrowserConfig({
    ...options,
    input: parsed
  });

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Browser backend: ${result.config.browser?.backend ?? "unconfigured"}.`,
      result.config.browser?.cdpUrl === undefined ? undefined : `CDP URL: ${result.config.browser.cdpUrl}`,
      result.config.browser?.launchCommand === undefined ? undefined : `Launch command: ${result.config.browser.launchCommand}`,
      `Auto-launch: ${result.config.browser?.autoLaunch === true ? "enabled" : "disabled"}`,
      `Config: ${result.path}`
    ].filter((line) => line !== undefined).join("\n")
  };
}

async function web(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand] = args;

  if (subcommand !== "enable" && subcommand !== "disable" && subcommand !== "status") {
    return {
      handled: true,
      exitCode: 0,
      output: [
        "EstaCoda web extraction",
        "  estacoda web status",
        "  estacoda web enable",
        "  estacoda web disable"
      ].join("\n")
    };
  }

  if (subcommand === "status") {
    const config = await loadRuntimeConfig(options);
    return {
      handled: true,
      exitCode: 0,
      output: [
        `Web extraction: ${config.web.enableNetwork ? "enabled" : "disabled"}`,
        config.web.maxContentChars === undefined ? undefined : `Max content chars: ${config.web.maxContentChars}`,
        `Config sources: ${config.sources.join(", ") || "none"}`
      ].filter((line) => line !== undefined).join("\n")
    };
  }

  const parsed = parseWebArgs(args.slice(1));
  const result = await setupWebConfig({
    ...options,
    input: {
      ...parsed,
      enableNetwork: subcommand === "enable"
    }
  });

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Web extraction ${subcommand === "enable" ? "enabled" : "disabled"}.`,
      `Config: ${result.path}`,
      result.config.web?.maxContentChars === undefined ? undefined : `Max content chars: ${result.config.web.maxContentChars}`
    ].filter((line) => line !== undefined).join("\n")
  };
}

async function telegram(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand] = args;

  if (subcommand !== "status" && subcommand !== "configure" && subcommand !== "disable" && subcommand !== "pair") {
    return {
      handled: true,
      exitCode: 0,
      output: [
        "EstaCoda Telegram channel",
        "  estacoda telegram status",
        "  estacoda telegram configure --bot-token-env ESTACODA_TELEGRAM_BOT_TOKEN",
        "  estacoda telegram configure --bot-token <token> --default-chat-id <chat>",
        "  estacoda telegram pair",
        "  estacoda telegram disable"
      ].join("\n")
    };
  }

  if (subcommand === "status") {
    const config = await loadRuntimeConfig(options);
    const telegram = config.channels.telegram;

    return {
      handled: true,
      exitCode: telegram.ready ? 0 : 1,
      output: [
        "Telegram channel",
        `Status: ${telegram.ready ? "ready" : telegram.enabled ? "configured, missing credentials" : "disabled"}`,
        `Enabled: ${telegram.enabled === true ? "yes" : "no"}`,
        telegram.botTokenEnv === undefined ? undefined : `Bot token env: ${telegram.botTokenEnv}`,
        telegram.defaultChatId === undefined ? undefined : `Default chat: ${telegram.defaultChatId}`,
        `Allowed users: ${(telegram.allowedUserIds ?? []).join(", ") || "none"}`,
        `Allowed chats: ${(telegram.allowedChatIds ?? []).join(", ") || "none"}`,
        telegram.missing === undefined ? undefined : `Missing: ${telegram.missing.join(", ")}`,
        `Config sources: ${config.sources.join(", ") || "none"}`
      ].filter((line) => line !== undefined).join("\n")
    };
  }

  if (subcommand === "pair") {
    const parsed = parseTelegramPairArgs(args.slice(1));
    const result = await createTelegramPairingCode({
      ...options,
      input: parsed
    });

    return {
      handled: true,
      exitCode: 0,
      output: [
        "Telegram pairing code created.",
        `Code: ${result.code}`,
        `Expires: ${result.expiresAt}`,
        `Config: ${result.path}`,
        "",
        "Send this code to your Telegram bot from the chat you want to pair.",
        "Then start the gateway with: estacoda gateway start --telegram"
      ].join("\n")
    };
  }

  const parsed = subcommand === "disable"
    ? { enabled: false } satisfies TelegramSetupInput
    : parseTelegramArgs(args.slice(1));
  const result = await setupTelegramConfig({
    ...options,
    input: parsed
  });

  return {
    handled: true,
    exitCode: 0,
    output: [
      `Telegram channel ${parsed.enabled === false ? "disabled" : "configured"}.`,
      `Config: ${result.path}`,
      result.config.channels?.telegram?.botTokenEnv === undefined ? undefined : `Bot token env: ${result.config.channels.telegram.botTokenEnv}`,
      result.config.channels?.telegram?.defaultChatId === undefined ? undefined : `Default chat: ${result.config.channels.telegram.defaultChatId}`,
      result.envExport === undefined ? undefined : `Shell export:\n${result.envExport}`,
      parsed.enabled === false ? undefined : "Next: run estacoda telegram status, then start the gateway when channel runtime is enabled."
    ].filter((line) => line !== undefined).join("\n")
  };
}

async function gateway(options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const [subcommand, ...rest] = args;

  if (subcommand !== "start" && subcommand !== "status") {
    return {
      handled: true,
      exitCode: 0,
      output: [
        "EstaCoda gateway",
        "  estacoda gateway status",
        "  estacoda gateway start --telegram",
        "  estacoda gateway start --telegram --once"
      ].join("\n")
    };
  }

  if (subcommand === "status") {
    const diagnostics = await getTelegramGatewayDiagnostics(options);

    return {
      handled: true,
      exitCode: diagnostics.ready ? 0 : 1,
      output: [
        "EstaCoda gateway status",
        `Gateway process: ${diagnostics.processMode}`,
        `Active adapters: ${diagnostics.enabled ? diagnostics.adapter : "none"}`,
        `Telegram: ${diagnostics.statusLabel}`,
        `Model route: ${diagnostics.modelRoute}`,
        `Context window: ${diagnostics.contextWindowTokens} tokens`,
        `Telegram security: ${diagnostics.securityLabel}`,
        `Allowed users: ${diagnostics.allowedUserIds.join(", ") || "none"}`,
        `Allowed chats: ${diagnostics.allowedChatIds.join(", ") || "none"}`,
        diagnostics.botTokenEnv === undefined ? undefined : `Telegram token env: ${diagnostics.botTokenEnv}`,
        `Telegram token present: ${diagnostics.botTokenPresent ? "yes" : "no"}`,
        diagnostics.defaultChatId === undefined ? undefined : `Default chat: ${diagnostics.defaultChatId}`,
        diagnostics.pollTimeoutSeconds === undefined ? undefined : `Poll timeout: ${diagnostics.pollTimeoutSeconds}s`,
        diagnostics.maxAttachmentBytes === undefined ? undefined : `Max attachment size: ${diagnostics.maxAttachmentBytes} bytes`,
        diagnostics.pairingExpiresAt === undefined ? undefined : `Pairing code active until: ${diagnostics.pairingExpiresAt}`,
        `Session DB: ${diagnostics.sessionDbPath}`,
        `Channel media: ${diagnostics.mediaRoot}`,
        `Approval store: ${diagnostics.approvalStorePath}`,
        `Logs: ${diagnostics.logsLocation}`,
        `Config sources: ${diagnostics.configSources.join(", ") || "none"}`,
        diagnostics.missing.length === 0 ? undefined : `Missing: ${diagnostics.missing.join(", ")}`
      ].filter((line) => line !== undefined).join("\n")
    };
  }

  if (!hasFlag(rest, "--telegram")) {
    return {
      handled: true,
      exitCode: 1,
      output: "Choose a channel: estacoda gateway start --telegram"
    };
  }

  const result = await runTelegramGateway({
    ...options,
    once: hasFlag(rest, "--once"),
    telegramFetch: options.telegramFetch
  });

  return {
    handled: true,
    exitCode: result.ok ? 0 : 1,
    output: result.output
  };
}

function parseSetupArgs(args: string[]): Partial<ProviderSetupInput> {
  const parsed: Partial<ProviderSetupInput> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--provider") {
      parsed.provider = next;
      index += 1;
    } else if (arg === "--model") {
      parsed.model = next;
      index += 1;
    } else if (arg === "--base-url") {
      parsed.baseUrl = next;
      index += 1;
    } else if (arg === "--api-key-env") {
      parsed.apiKeyEnv = next;
      index += 1;
    } else if (arg === "--api-key") {
      parsed.apiKey = next;
      index += 1;
    } else if (arg === "--project") {
      parsed.scope = "project";
    } else if (arg === "--user") {
      parsed.scope = "user";
    } else if (arg === "--offline") {
      parsed.enableNetwork = false;
    } else if (arg === "--strategy") {
      parsed.credentialPoolStrategy = next as ProviderSetupInput["credentialPoolStrategy"];
      index += 1;
    }
  }

  return parsed;
}

function parseWebArgs(args: string[]): Partial<WebSetupInput> {
  const parsed: Partial<WebSetupInput> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--max-content-chars") {
      parsed.maxContentChars = Number.parseInt(next ?? "", 10);
      index += 1;
    } else if (arg === "--project") {
      parsed.scope = "project";
    } else if (arg === "--user") {
      parsed.scope = "user";
    }
  }

  if (Number.isNaN(parsed.maxContentChars)) {
    parsed.maxContentChars = undefined;
  }

  return parsed;
}

function parseBrowserArgs(args: string[]): Partial<BrowserSetupInput> {
  const parsed: Partial<BrowserSetupInput> = {
    backend: "local-cdp"
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--backend") {
      parsed.backend = next as BrowserSetupInput["backend"];
      index += 1;
    } else if (arg === "--cdp-url") {
      parsed.cdpUrl = next;
      index += 1;
    } else if (arg === "--launch-command") {
      parsed.launchCommand = next;
      index += 1;
    } else if (arg === "--auto-launch") {
      parsed.autoLaunch = true;
    } else if (arg === "--project") {
      parsed.scope = "project";
    } else if (arg === "--user") {
      parsed.scope = "user";
    }
  }

  return parsed;
}

function parseTelegramArgs(args: string[]): TelegramSetupInput {
  const parsed: TelegramSetupInput = {
    enabled: true
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--bot-token-env") {
      parsed.botTokenEnv = next;
      index += 1;
    } else if (arg === "--bot-token") {
      parsed.botToken = next;
      index += 1;
    } else if (arg === "--default-chat-id") {
      parsed.defaultChatId = next;
      index += 1;
    } else if (arg === "--allow-user") {
      parsed.allowedUserIds = [...(parsed.allowedUserIds ?? []), next ?? ""].filter(Boolean);
      index += 1;
    } else if (arg === "--allow-chat") {
      parsed.allowedChatIds = [...(parsed.allowedChatIds ?? []), next ?? ""].filter(Boolean);
      index += 1;
    } else if (arg === "--poll-timeout-seconds") {
      parsed.pollTimeoutSeconds = Number.parseInt(next ?? "", 10);
      index += 1;
    } else if (arg === "--project") {
      parsed.scope = "project";
    } else if (arg === "--user") {
      parsed.scope = "user";
    }
  }

  if (Number.isNaN(parsed.pollTimeoutSeconds)) {
    parsed.pollTimeoutSeconds = undefined;
  }

  return parsed;
}

function parseTelegramPairArgs(args: string[]): {
  code?: string;
  ttlMinutes?: number;
  scope?: "user" | "project";
} {
  const parsed: {
    code?: string;
    ttlMinutes?: number;
    scope?: "user" | "project";
  } = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--code") {
      parsed.code = next;
      index += 1;
    } else if (arg === "--ttl-minutes") {
      parsed.ttlMinutes = Number.parseInt(next ?? "", 10);
      index += 1;
    } else if (arg === "--project") {
      parsed.scope = "project";
    } else if (arg === "--user") {
      parsed.scope = "user";
    }
  }

  if (Number.isNaN(parsed.ttlMinutes)) {
    parsed.ttlMinutes = undefined;
  }

  return parsed;
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((arg) => flags.includes(arg));
}

function help(): string {
  return [
    "EstaCoda commands",
    "  estacoda setup   Configure provider/model credentials",
    "  estacoda setup --interactive",
    "  estacoda web     Configure web extraction",
    "  estacoda browser Configure browser backend",
    "  estacoda telegram Configure Telegram channel",
    "  estacoda telegram pair Pair a Telegram chat",
    "  estacoda gateway Start channel gateway",
    "  estacoda model   Show current model",
    "  estacoda tools   Show available tools by toolset",
    "  estacoda doctor  Check setup health",
    "  estacoda doctor --live  Make a tiny live provider call",
    "  estacoda doctor --live-tools  Verify live provider tool-calling"
  ].join("\n");
}
