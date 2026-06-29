import { describe, expect, it } from "vitest";
import type { FetchLike } from "../providers/openai-compatible-provider.js";
import {
  collectOpenAICompatibleEndpointFlow,
  isValidOpenAICompatibleEndpointBaseUrl,
  type OpenAICompatibleAuthSelection,
  type OpenAICompatibleChatTestSelection,
  type OpenAICompatibleEndpointAction,
  type OpenAICompatibleEndpointIntroAction,
  type OpenAICompatibleEndpointFlowUi,
  type OpenAICompatibleModelChoice,
  type OpenAICompatibleModelSelection,
  type OpenAICompatibleSummaryDecision,
} from "./openai-compatible-endpoint-flow.js";

function response(input: {
  readonly ok: boolean;
  readonly status?: number;
  readonly statusText?: string;
  readonly json?: () => Promise<unknown>;
}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: input.ok,
    status: input.status ?? (input.ok ? 200 : 500),
    statusText: input.statusText ?? (input.ok ? "OK" : "Error"),
    json: input.json ?? (async () => ({})),
    text: async () => "",
    body: null,
  };
}

type ScriptedUiInput = {
  readonly introActions?: readonly OpenAICompatibleEndpointIntroAction[];
  readonly baseUrls?: readonly string[];
  readonly endpointActions?: readonly OpenAICompatibleEndpointAction[];
  readonly modelSelections?: readonly OpenAICompatibleModelSelection[];
  readonly manualModelIds?: readonly string[];
  readonly contextWindowTokens?: ReadonlyArray<number | undefined>;
  readonly authSelections?: readonly OpenAICompatibleAuthSelection[];
  readonly authEnvVars?: readonly string[];
  readonly secrets?: ReadonlyArray<string | undefined>;
  readonly chatTests?: readonly OpenAICompatibleChatTestSelection[];
  readonly summaries?: readonly OpenAICompatibleSummaryDecision[];
};

function scriptedUi(input: ScriptedUiInput = {}): OpenAICompatibleEndpointFlowUi & {
  readonly observedModelChoices: OpenAICompatibleModelChoice[][];
  readonly summaryLines: string[][];
  readonly introMessages: string[][];
} {
  const introActions = [...(input.introActions ?? ["continue"])];
  const baseUrls = [...(input.baseUrls ?? [""])];
  const endpointActions = [...(input.endpointActions ?? ["check"])];
  const modelSelections = [...(input.modelSelections ?? [{ kind: "model", modelId: "qwen2.5:7b" }])];
  const manualModelIds = [...(input.manualModelIds ?? ["manual-chat"])];
  const contextWindowTokens = [...(input.contextWindowTokens ?? [undefined])];
  const authSelections = [...(input.authSelections ?? ["none"])];
  const authEnvVars = [...(input.authEnvVars ?? [""])];
  const secrets = [...(input.secrets ?? [undefined])];
  const chatTests = [...(input.chatTests ?? ["skip"])];
  const summaries = [...(input.summaries ?? ["review"])];
  const observedModelChoices: OpenAICompatibleModelChoice[][] = [];
  const summaryLines: string[][] = [];
  const introMessages: string[][] = [];

  return {
    observedModelChoices,
    summaryLines,
    introMessages,
    selectEndpointIntro: async ({ text }) => {
      introMessages.push([
        text.body,
        text.current,
        text.endpoint,
        text.defaultEndpoint,
        text.process,
        text.destination,
      ]);
      return introActions.shift() ?? "continue";
    },
    promptBaseUrl: async () => baseUrls.shift() ?? "",
    selectEndpointAction: async () => endpointActions.shift() ?? "cancel",
    selectModel: async ({ choices }) => {
      observedModelChoices.push([...choices]);
      return modelSelections.shift() ?? { kind: "cancel" };
    },
    promptManualModelId: async () => manualModelIds.shift() ?? "",
    promptContextWindowTokens: async () => contextWindowTokens.shift(),
    selectAuth: async () => authSelections.shift() ?? "cancel",
    promptAuthEnvVar: async () => authEnvVars.shift() ?? "",
    promptSecret: async () => secrets.shift(),
    selectChatCompletionTest: async () => chatTests.shift() ?? "not-tested",
    confirmSummary: async ({ text }) => {
      summaryLines.push([...text.lines]);
      return summaries.shift() ?? "cancel";
    },
  };
}

describe("openai-compatible endpoint flow", () => {
  it("builds primary-route draft data for a discovered model", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const fetchLike: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/models")) {
        return response({
          ok: true,
          json: async () => ({ data: [{ id: "qwen2.5:7b" }, { id: "nomic-embed-text" }] }),
        });
      }
      return response({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "OK" } }] }),
      });
    };
    const ui = scriptedUi({
      contextWindowTokens: [8192],
      chatTests: ["run"],
    });

    const result = await collectOpenAICompatibleEndpointFlow({
      providerId: "local",
      defaultBaseUrl: "http://localhost:11434/v1",
      locale: "en",
      ui,
      fetch: fetchLike,
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.modelId).toBe("qwen2.5:7b");
    expect(result.modelSource).toBe("discovered");
    expect(result.contextWindowTokens).toBe(8192);
    expect(result.checks.modelList.status).toBe("passed");
    expect(result.checks.chatCompletion.status).toBe("passed");
    expect(result.credentialAction).toBeUndefined();
    expect(result.routeAction.reviewValues).toMatchObject({
      provider: "local",
      model: "qwen2.5:7b",
      baseUrl: "http://localhost:11434/v1",
      contextWindowTokens: 8192,
      authMethod: "none",
      modelSource: "discovered",
      modelListStatus: "passed",
      chatCompletionStatus: "passed",
      toolsStatus: "unknown",
    });
    expect(ui.observedModelChoices[0]).toEqual([
      expect.objectContaining({ modelId: "qwen2.5:7b", badge: "discovered" }),
      expect.objectContaining({ modelId: "nomic-embed-text", badge: "embedding" }),
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:11434/v1/models",
      "http://localhost:11434/v1/chat/completions",
    ]);
  });

  it("does not block manual model entry when /models fails", async () => {
    const ui = scriptedUi({
      modelSelections: [{ kind: "manual" }],
      manualModelIds: ["private-chat-model"],
      chatTests: ["skip"],
    });

    const result = await collectOpenAICompatibleEndpointFlow({
      providerId: "local",
      defaultBaseUrl: "http://localhost:1234/v1",
      locale: "en",
      ui,
      fetch: async () => response({ ok: false, status: 401, statusText: "Unauthorized" }),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.modelId).toBe("private-chat-model");
    expect(result.modelSource).toBe("manual");
    expect(result.checks.modelList.status).toBe("failed");
    expect(result.checks.chatCompletion.status).toBe("skipped");
    expect(result.routeAction.reviewValues).toMatchObject({
      model: "private-chat-model",
      modelSource: "manual",
      modelListStatus: "failed",
      chatCompletionStatus: "skipped",
    });
  });

  it("shows current route and default endpoint in the intro step", async () => {
    const ui = scriptedUi({
      endpointActions: ["manual"],
      manualModelIds: ["manual-local"],
      authSelections: ["none"],
      chatTests: ["skip"],
    });

    const result = await collectOpenAICompatibleEndpointFlow({
      providerId: "local",
      defaultBaseUrl: "http://localhost:11434/v1",
      currentRoute: {
        providerId: "codex",
        modelId: "gpt-5.5",
      },
      locale: "en",
      ui,
      fetch: async () => response({ ok: true }),
    });

    expect(result.kind).toBe("ready");
    expect(ui.introMessages[0]).toEqual(expect.arrayContaining([
      "Current: codex/gpt-5.5",
      "Default endpoint: http://localhost:11434/v1",
      expect.stringContaining("/models"),
      "Requests will be sent to the endpoint you choose.",
    ]));
  });

  it("treats Ctrl+C during endpoint URL entry as cancellation", async () => {
    const ui = scriptedUi({
      introActions: ["change-endpoint"],
      baseUrls: ["\u0003"],
    });

    const result = await collectOpenAICompatibleEndpointFlow({
      providerId: "local",
      defaultBaseUrl: "http://localhost:11434/v1",
      locale: "en",
      ui,
      fetch: async () => response({ ok: true }),
    });

    expect(result.kind).toBe("cancelled");
  });

  it("allows authentication before discovery without exposing the raw secret in drafts", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const fetchLike: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/models")) {
        return response({
          ok: true,
          json: async () => ({ data: [{ id: "secure-chat" }] }),
        });
      }
      return response({ ok: true });
    };
    const ui = scriptedUi({
      endpointActions: ["auth", "check"],
      modelSelections: [{ kind: "model", modelId: "secure-chat" }],
      authSelections: ["enter"],
      authEnvVars: [""],
      secrets: ["sk-private-endpoint"],
      chatTests: ["run"],
    });

    const result = await collectOpenAICompatibleEndpointFlow({
      providerId: "local",
      defaultBaseUrl: "https://private.example/v1",
      locale: "en",
      ui,
      fetch: fetchLike,
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.apiKeyEnv).toBe("OPENAI_COMPATIBLE_API_KEY");
    expect(result.pendingCredentialWrite).toEqual({
      envVarName: "OPENAI_COMPATIBLE_API_KEY",
      value: "sk-private-endpoint",
    });
    expect(result.credentialAction?.credentialRefs).toEqual([
      { kind: "env", name: "OPENAI_COMPATIBLE_API_KEY", value: "not-included" },
    ]);
    expect(JSON.stringify(result.routeAction)).not.toContain("sk-private-endpoint");
    expect(JSON.stringify(result.credentialAction)).not.toContain("sk-private-endpoint");
    expect(calls[0]?.init.headers.authorization).toBe("Bearer sk-private-endpoint");
    expect(calls[1]?.init.headers.authorization).toBe("Bearer sk-private-endpoint");
  });

  it("creates a credential-reference draft for env-var auth without a deferred secret write", async () => {
    const ui = scriptedUi({
      endpointActions: ["manual"],
      manualModelIds: ["llama.cpp-chat"],
      authSelections: ["env"],
      authEnvVars: ["CUSTOM_LOCAL_KEY"],
      chatTests: ["not-tested"],
    });

    const result = await collectOpenAICompatibleEndpointFlow({
      providerId: "local",
      defaultBaseUrl: "http://localhost:8080/v1",
      locale: "en",
      ui,
      fetch: async () => response({ ok: true }),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.apiKeyEnv).toBe("CUSTOM_LOCAL_KEY");
    expect(result.pendingCredentialWrite).toBeUndefined();
    expect(result.credentialAction?.id).toBe("store-provider-credential-reference");
    expect(result.credentialAction?.reviewValues).toMatchObject({
      provider: "local",
      model: "llama.cpp-chat",
      apiKeyEnv: "CUSTOM_LOCAL_KEY",
    });
    expect(result.checks.modelList.status).toBe("notTested");
    expect(result.checks.chatCompletion.status).toBe("notTested");
  });

  it("accepts only absolute http(s) endpoint URLs", () => {
    expect(isValidOpenAICompatibleEndpointBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isValidOpenAICompatibleEndpointBaseUrl("https://private.example/v1")).toBe(true);
    expect(isValidOpenAICompatibleEndpointBaseUrl("localhost:11434/v1")).toBe(false);
    expect(isValidOpenAICompatibleEndpointBaseUrl("file:///tmp/server")).toBe(false);
  });
});
