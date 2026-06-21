import type {
  AuxiliaryModelTask,
  ModelProfile,
  ProviderId,
  ProviderSetupMode,
  ProviderUxKind,
  ResolvedAuxiliaryRoute,
  ResolvedModelRoute
} from "../contracts/provider.js";
import type {
  ModelLifecycle,
  ModelUsageClass
} from "../model-catalog/model-catalog-policy.js";

export type ModelRefreshReport = {
  /** Domain from which the remote catalog was fetched. */
  sourceDomain: string;
  /** Absolute path to the local cache file. */
  cachePath: string;
  /** ISO timestamp of the snapshot. */
  snapshotTimestamp: string;
  /** Whether the fetched snapshot differed from the previous local cache. */
  cacheChanged: boolean;
  /** Number of models in the refreshed snapshot. */
  modelsCount: number;
  /** Number of providers in the refreshed snapshot. */
  providersCount: number;
  /** Human-readable warnings (never containing secrets). */
  warnings: string[];
};

export type ModelCatalogReport = {
  primaryRoute: ModelRouteDiagnostic;
  fallbackRoutes: ModelRouteDiagnostic[];
  auxiliaryRoutes: Array<{
    diagnostic: ModelRouteDiagnostic;
    task: AuxiliaryModelTask;
    source: ResolvedAuxiliaryRoute["source"];
    fallbackToMain: boolean;
  }>;
  catalogSource: string;
  catalogTimestamp: string;
  warnings: string[];
};

export type ModelProviderReport = {
  id: ProviderId;
  name: string;
  uxKind: ProviderUxKind;
  setupMode: ProviderSetupMode;
  configured: boolean;
  executable: boolean;
  catalogOnly: boolean;
  modelsCount: number;
  /** Route-level credential readiness. */
  credentialReady: boolean;
  /** Route-level endpoint readiness (URL is valid). */
  endpointReady: boolean;
  warnings: string[];
};

export type ModelCatalogEntryReport = {
  routeKey: string;
  provider: ProviderId;
  id: string;
  baseUrl?: string;
  profile: ModelProfile;
  configured: boolean;
  executable: boolean;
  catalogOnly: boolean;
  /** Origin of this entry in the merged catalog. */
  source: "models-dev" | "configured" | "manual" | "fallback-known";
  lifecycle: ModelLifecycle;
  usageClass: ModelUsageClass;
  lifecycleNote?: string;
  credentialReady: boolean;
  endpointReady: boolean;
  warnings: string[];
  live?: boolean;
  endpointType?: "openai" | "anthropic" | "custom";
  cost?: { inputPer1k?: number; outputPer1k?: number };
  documentationUrl?: string;
  logoUrl?: string;
  diagnosticFields?: Record<string, unknown>;
};

export type ModelRouteDiagnostic = {
  route: ResolvedModelRoute;
  executable: boolean;
  catalogOnly: boolean;
  credentialReady: boolean;
  endpointReady: boolean;
  /** Literal error messages (no secrets). */
  errors: string[];
  warnings: string[];
};

export type ModelStatusReport = {
  primary: ModelRouteDiagnostic;
  fallbacks: ModelRouteDiagnostic[];
  auxiliary: Record<string, ModelRouteDiagnostic>;
  auxiliaryRoutes: Array<{
    diagnostic: ModelRouteDiagnostic;
    route: ResolvedAuxiliaryRoute;
    scope: string;
    inFlight: number;
    queued: number;
  }>;
  overallReady: boolean;
  warnings: string[];
};

export type ModelSetupReview = {
  route: ResolvedModelRoute;
  providerKind: ProviderUxKind;
  setupMode: ProviderSetupMode;
  endpointVisible: boolean;
  credentialVisible: boolean;
  /** Clear text of the endpoint URL, never headers or keys. */
  endpointUrl: string;
  warnings: string[];
};
