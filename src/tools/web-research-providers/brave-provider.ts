import type {
  WebResearchCredentialResolver,
  WebResearchFetch,
  WebResearchProvider,
  WebSearchOptions,
  WebSearchResult
} from "../web-research-provider.js";
import {
  defaultWebResearchCredentialResolver,
  defaultWebResearchFetch
} from "../web-research-provider.js";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_BRAVE_API_KEY_ENV = "BRAVE_SEARCH_API_KEY";

type BraveProviderOptions = {
  apiKeyEnv?: string;
  fetch?: WebResearchFetch;
  credentialResolver?: WebResearchCredentialResolver;
};

type BraveSearchResponse = {
  web?: {
    results?: unknown;
  };
};

export const braveProvider: WebResearchProvider = createBraveProvider();

function createBraveProvider(options: BraveProviderOptions = {}): WebResearchProvider {
  const apiKeyEnv = options.apiKeyEnv ?? DEFAULT_BRAVE_API_KEY_ENV;
  const fetch = options.fetch ?? defaultWebResearchFetch();
  const credentialResolver = options.credentialResolver ?? defaultWebResearchCredentialResolver();

  return {
    name: "brave",
    displayName: "Brave Search",
    capabilities: { search: true },
    configure: (context) => createBraveProvider({
      apiKeyEnv: context.config.brave?.apiKeyEnv,
      fetch: context.fetch,
      credentialResolver: context.credentialResolver
    }),
    getAvailability: async () => {
      const credential = await resolveBraveCredential({ apiKeyEnv, credentialResolver });
      if (credential.value === undefined) {
        return { available: false, reason: credential.reason };
      }
      return { available: true };
    },
    search: async (query, searchOptions) => {
      const credential = await resolveBraveCredential({ apiKeyEnv, credentialResolver });
      if (credential.value === undefined) {
        throw new Error(`Brave Search is unavailable: ${credential.reason}`);
      }

      return searchBrave({
        query,
        apiKey: credential.value,
        fetch,
        options: searchOptions
      });
    }
  };
}

async function resolveBraveCredential(input: {
  apiKeyEnv: string;
  credentialResolver: WebResearchCredentialResolver;
}): Promise<{ value?: string; reason: string }> {
  const resolved = await input.credentialResolver({
    providerId: "brave",
    providerConfig: {
      apiKeyEnv: input.apiKeyEnv
    }
  });
  if (resolved.credential?.kind === "bearer" && resolved.credential.value.length > 0) {
    return {
      value: resolved.credential.value,
      reason: "ready"
    };
  }
  return {
    reason: resolved.diagnostic.message ?? `Missing env var ${input.apiKeyEnv}`
  };
}

async function searchBrave(input: {
  query: string;
  apiKey: string;
  fetch: WebResearchFetch;
  options?: WebSearchOptions;
}): Promise<WebSearchResult[]> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(normalizeCount(input.options?.maxResults)));

  let response: Awaited<ReturnType<WebResearchFetch>>;
  try {
    response = await input.fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Subscription-Token": input.apiKey,
        Accept: "application/json"
      },
      signal: input.options?.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Brave Search request was aborted.");
    }
    throw new Error("Brave Search request failed.");
  }

  if (!response.ok) {
    throw new Error(braveStatusMessage(response.status));
  }

  let parsed: BraveSearchResponse;
  try {
    parsed = JSON.parse(await response.text()) as BraveSearchResponse;
  } catch {
    throw new Error("Brave Search returned invalid JSON.");
  }

  return mapBraveResults(parsed);
}

function normalizeCount(maxResults: number | undefined): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) {
    return 10;
  }
  return Math.max(1, Math.min(Math.trunc(maxResults), 20));
}

function mapBraveResults(response: BraveSearchResponse): WebSearchResult[] {
  const results = response.web?.results;
  if (!Array.isArray(results)) {
    throw new Error("Brave Search response was malformed.");
  }
  if (results.length === 0) {
    return [];
  }

  const mapped = results
    .filter(isRecord)
    .map((result): WebSearchResult | undefined => {
      if (typeof result.title !== "string" || typeof result.url !== "string") {
        return undefined;
      }
      const mappedResult: WebSearchResult = {
        title: result.title,
        url: result.url
      };
      if (typeof result.description === "string") {
        mappedResult.snippet = result.description;
      }
      return mappedResult;
    })
    .filter((result): result is WebSearchResult => result !== undefined);

  if (mapped.length === 0) {
    throw new Error("Brave Search response contained malformed results.");
  }

  return mapped;
}

function braveStatusMessage(status: number): string {
  if (status === 401) return "Brave Search authentication failed with HTTP 401.";
  if (status === 403) return "Brave Search authorization failed with HTTP 403.";
  if (status === 429) return "Brave Search rate limit exceeded with HTTP 429.";
  return `Brave Search request failed with HTTP ${status}.`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
