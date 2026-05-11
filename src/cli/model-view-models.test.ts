import { describe, it, expect } from "vitest";
import type { AuxiliaryModelTask, ProviderId, ProviderUxKind, ProviderSetupMode } from "../contracts/provider.js";
import type { CatalogProvider, SelectableModel } from "../providers/model-selection-catalog.js";
import type { ModelCatalogReport, ModelRouteDiagnostic, ModelSetupReview } from "../reports/model-reports.js";
import {
  toModelRow,
  toProviderRow,
  toPrimaryRouteSummary,
  toFallbackRouteSummaries,
  toAuxiliaryRouteSummaries,
  toSetupReviewSummary
} from "./model-view-models.js";
import {
  renderModelList,
  renderProviderList,
  renderPrimaryRouteSummary,
  renderFallbackRouteSummaries,
  renderAuxiliaryRouteSummaries,
  renderSetupReview
} from "./model-renderers.js";

function makeSelectableModel(overrides?: Partial<SelectableModel>): SelectableModel {
  return {
    routeKey: JSON.stringify(["openai", "gpt-4o", ""]),
    provider: "openai" as ProviderId,
    id: "gpt-4o",
    baseUrl: undefined,
    profile: {
      id: "gpt-4o",
      provider: "openai" as ProviderId,
      contextWindowTokens: 128_000,
      supportsTools: true,
      supportsVision: true,
      supportsStructuredOutput: true,
      supportsReasoning: false,
      supportsStreaming: true,
      freeOrOpenWeights: false
    },
    configured: true,
    executable: true,
    catalogOnly: false,
    source: "configured",
    credentialReady: true,
    endpointReady: true,
    warnings: [],
    ...overrides
  };
}

function makeCatalogProvider(overrides?: Partial<CatalogProvider>): CatalogProvider {
  return {
    id: "openai" as ProviderId,
    name: "OpenAI",
    uxKind: "hosted" as ProviderUxKind,
    setupMode: "api-key" as ProviderSetupMode,
    configured: true,
    executable: true,
    catalogOnly: false,
    modelsCount: 5,
    credentialReady: true,
    endpointReady: true,
    ...overrides
  };
}

function makeModelRouteDiagnostic(overrides?: Partial<ModelRouteDiagnostic>): ModelRouteDiagnostic {
  return {
    route: {
      provider: "openai" as ProviderId,
      id: "gpt-4o",
      profile: {
        id: "gpt-4o",
        provider: "openai" as ProviderId,
        contextWindowTokens: 128_000,
        supportsTools: true,
        supportsVision: true,
        supportsStructuredOutput: true
      },
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY"
    },
    executable: true,
    catalogOnly: false,
    credentialReady: true,
    endpointReady: true,
    errors: [],
    warnings: [],
    ...overrides
  };
}

function makeModelCatalogReport(overrides?: Partial<ModelCatalogReport>): ModelCatalogReport {
  const primary = makeModelRouteDiagnostic();
  return {
    primaryRoute: primary,
    fallbackRoutes: [
      {
        ...primary,
        route: {
          ...primary.route,
          provider: "deepseek" as ProviderId,
          id: "deepseek-chat",
          baseUrl: undefined,
          apiKeyEnv: undefined
        }
      }
    ],
    auxiliaryRoutes: [
      {
        diagnostic: {
          ...primary,
          route: {
            ...primary.route,
            provider: "openai" as ProviderId,
            id: "gpt-4o-vision"
          }
        },
        task: "vision" as AuxiliaryModelTask,
        source: "auto-main",
        fallbackToMain: true
      }
    ],
    catalogSource: "models.dev",
    catalogTimestamp: "2024-01-01T00:00:00.000Z",
    warnings: [],
    ...overrides
  };
}

function makeModelSetupReview(overrides?: Partial<ModelSetupReview>): ModelSetupReview {
  return {
    route: {
      provider: "local" as ProviderId,
      id: "llama3",
      profile: {
        id: "llama3",
        provider: "local" as ProviderId,
        contextWindowTokens: 8_000,
        supportsTools: true,
        supportsVision: false,
        supportsStructuredOutput: true
      },
      baseUrl: "http://localhost:11434/v1"
    },
    providerKind: "local" as ProviderUxKind,
    setupMode: "none",
    endpointVisible: true,
    credentialVisible: false,
    endpointUrl: "http://localhost:11434/v1",
    warnings: ["Local endpoint may not support all features"],
    ...overrides
  };
}

describe("toModelRow", () => {
  it("derives from SelectableModel", () => {
    const selectable = makeSelectableModel();
    const row = toModelRow(selectable);
    expect(row.routeKey).toBe(selectable.routeKey);
    expect(row.provider).toBe(selectable.provider);
    expect(row.id).toBe(selectable.id);
    expect(row.label).toBe("openai/gpt-4o");
  });

  it("maps capability badges from profile fields", () => {
    const selectable = makeSelectableModel();
    const row = toModelRow(selectable);
    const tools = row.capabilityBadges.find((b) => b.kind === "tools");
    const vision = row.capabilityBadges.find((b) => b.kind === "vision");
    const structured = row.capabilityBadges.find((b) => b.kind === "structured");
    const reasoning = row.capabilityBadges.find((b) => b.kind === "reasoning");
    expect(tools?.enabled).toBe(true);
    expect(vision?.enabled).toBe(true);
    expect(structured?.enabled).toBe(true);
    expect(reasoning?.enabled).toBe(false);
  });

  it("marks status ready when executable and ready", () => {
    const row = toModelRow(makeSelectableModel());
    expect(row.status).toBe("ready");
    expect(row.endpointReadiness.ready).toBe(true);
    expect(row.credentialReadiness.ready).toBe(true);
  });

  it("marks status blocked when not executable", () => {
    const row = toModelRow(makeSelectableModel({ executable: false, catalogOnly: true }));
    expect(row.status).toBe("blocked");
  });

  it("marks status warning when credential not ready", () => {
    const row = toModelRow(makeSelectableModel({ credentialReady: false }));
    expect(row.status).toBe("warning");
    expect(row.credentialReadiness.warning).toBe("Credential not ready");
  });

  it("marks status warning when endpoint not ready", () => {
    const row = toModelRow(makeSelectableModel({ endpointReady: false }));
    expect(row.status).toBe("warning");
    expect(row.endpointReadiness.warning).toBe("Endpoint not ready");
  });
});

describe("toProviderRow", () => {
  it("derives from CatalogProvider", () => {
    const provider = makeCatalogProvider();
    const row = toProviderRow(provider);
    expect(row.provider).toBe(provider.id);
    expect(row.name).toBe(provider.name);
    expect(row.modelCount).toBe(provider.modelsCount);
  });

  it("marks readiness ready when endpoint and credential are ready", () => {
    const row = toProviderRow(makeCatalogProvider());
    expect(row.readiness.ready).toBe(true);
    expect(row.readiness.warning).toBeUndefined();
  });

  it("marks readiness not ready when endpoint is not ready", () => {
    const row = toProviderRow(makeCatalogProvider({ endpointReady: false }));
    expect(row.readiness.ready).toBe(false);
    expect(row.readiness.warning).toBe("Provider not fully ready");
  });
});

describe("toPrimaryRouteSummary", () => {
  it("derives from ModelCatalogReport", () => {
    const report = makeModelCatalogReport();
    const summary = toPrimaryRouteSummary(report);
    expect(summary.route.provider).toBe("openai");
    expect(summary.route.id).toBe("gpt-4o");
    expect(summary.fallbackSummaries.length).toBe(1);
  });

  it("includes fallback summaries in order", () => {
    const report = makeModelCatalogReport({
      fallbackRoutes: [
        makeModelRouteDiagnostic({ route: { ...makeModelRouteDiagnostic().route, provider: "deepseek" as ProviderId, id: "deepseek-chat" } }),
        makeModelRouteDiagnostic({ route: { ...makeModelRouteDiagnostic().route, provider: "kimi" as ProviderId, id: "kimi-k2" } })
      ]
    });
    const summary = toPrimaryRouteSummary(report);
    expect(summary.fallbackSummaries[0]!.order).toBe(1);
    expect(summary.fallbackSummaries[1]!.order).toBe(2);
  });
});

describe("toFallbackRouteSummaries", () => {
  it("derives from ModelCatalogReport", () => {
    const report = makeModelCatalogReport();
    const summaries = toFallbackRouteSummaries(report);
    expect(summaries.length).toBe(1);
    expect(summaries[0]!.route.provider).toBe("deepseek");
    expect(summaries[0]!.order).toBe(1);
  });
});

describe("toAuxiliaryRouteSummaries", () => {
  it("derives from ModelCatalogReport", () => {
    const report = makeModelCatalogReport();
    const summaries = toAuxiliaryRouteSummaries(report);
    expect(summaries.length).toBe(1);
    expect(summaries[0]!.task).toBe("vision");
    expect(summaries[0]!.source).toBe("auto-main");
    expect(summaries[0]!.fallbackToMain).toBe(true);
  });
});

describe("toSetupReviewSummary", () => {
  it("derives from ModelSetupReview", () => {
    const review = makeModelSetupReview();
    const summary = toSetupReviewSummary(review);
    expect(summary.route.provider).toBe("local");
    expect(summary.providerKind).toBe("local");
    expect(summary.endpointVisible).toBe("http://localhost:11434/v1");
    expect(summary.credentialVisible).toBe("Not configured");
    expect(summary.warnings.length).toBe(1);
  });

  it("shows credential env var when visible and present", () => {
    const review = makeModelSetupReview({
      credentialVisible: true,
      route: {
        ...makeModelSetupReview().route,
        apiKeyEnv: "LOCAL_API_KEY"
      }
    });
    const summary = toSetupReviewSummary(review);
    expect(summary.credentialVisible).toBe("env:LOCAL_API_KEY");
  });
});

describe("renderModelList", () => {
  it("handles empty list gracefully", () => {
    const output = renderModelList([]);
    expect(output).toBe("No models found.");
    expect(output.length).toBeGreaterThan(0);
  });

  it("produces non-empty output for valid inputs", () => {
    const rows = [toModelRow(makeSelectableModel())];
    const output = renderModelList(rows);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("openai/gpt-4o");
  });

  it("includes capability badges when enabled", () => {
    const rows = [toModelRow(makeSelectableModel())];
    const output = renderModelList(rows);
    expect(output).toContain("tools");
    expect(output).toContain("vision");
    expect(output).toContain("structured");
  });
});

describe("renderProviderList", () => {
  it("handles empty list gracefully", () => {
    const output = renderProviderList([]);
    expect(output).toBe("No providers found.");
    expect(output.length).toBeGreaterThan(0);
  });

  it("produces non-empty output for valid inputs", () => {
    const rows = [toProviderRow(makeCatalogProvider())];
    const output = renderProviderList(rows);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("openai");
    expect(output).toContain("executable");
  });
});

describe("renderPrimaryRouteSummary", () => {
  it("produces non-empty output for valid inputs", () => {
    const summary = toPrimaryRouteSummary(makeModelCatalogReport());
    const output = renderPrimaryRouteSummary(summary);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Primary route:");
    expect(output).toContain("openai/gpt-4o");
  });
});

describe("renderFallbackRouteSummaries", () => {
  it("handles empty list gracefully", () => {
    const output = renderFallbackRouteSummaries([]);
    expect(output).toBe("No fallback routes configured.");
    expect(output.length).toBeGreaterThan(0);
  });

  it("produces non-empty output for valid inputs", () => {
    const summaries = toFallbackRouteSummaries(makeModelCatalogReport());
    const output = renderFallbackRouteSummaries(summaries);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("deepseek");
  });
});

describe("renderAuxiliaryRouteSummaries", () => {
  it("handles empty list gracefully", () => {
    const output = renderAuxiliaryRouteSummaries([]);
    expect(output).toBe("No auxiliary routes configured.");
    expect(output.length).toBeGreaterThan(0);
  });

  it("produces non-empty output for valid inputs", () => {
    const summaries = toAuxiliaryRouteSummaries(makeModelCatalogReport());
    const output = renderAuxiliaryRouteSummaries(summaries);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("vision");
  });
});

describe("renderSetupReview", () => {
  it("produces non-empty output for valid inputs", () => {
    const summary = toSetupReviewSummary(makeModelSetupReview());
    const output = renderSetupReview(summary);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Setup review for");
    expect(output).toContain("Warnings:");
  });
});
