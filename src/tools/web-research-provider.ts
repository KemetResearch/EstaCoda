import type { RuntimeCredentialResolution, RuntimeCredentialResolverOptions } from "../providers/runtime-credential-resolver.js";
import { resolveRuntimeCredential } from "../providers/runtime-credential-resolver.js";

export type WebResearchCapability = "search" | "extract" | "crawl";

export type ProviderAvailability = {
  available: boolean;
  reason?: string;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

export type WebExtractResult = {
  url: string;
  title?: string;
  content: string;
  contentType?: string;
  status?: number;
};

export type WebCrawlResult = {
  url: string;
  pages: Array<{
    url: string;
    title?: string;
    content: string;
  }>;
};

export type WebSearchOptions = {
  maxResults?: number;
  signal?: AbortSignal;
};

export type WebExtractOptions = {
  maxContentChars?: number;
  signal?: AbortSignal;
};

export type WebCrawlOptions = {
  maxPages?: number;
  maxContentChars?: number;
  signal?: AbortSignal;
};

export type WebResearchFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}>;

export type WebResearchCredentialResolver = (options: RuntimeCredentialResolverOptions) => Promise<RuntimeCredentialResolution>;

export type WebResearchProvider = {
  name: string;
  displayName: string;
  capabilities: {
    search?: true;
    extract?: true;
    crawl?: true;
  };
  configure?(context: WebResearchProviderContext): WebResearchProvider;
  getAvailability(): ProviderAvailability | Promise<ProviderAvailability>;
  search?(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
  extract?(url: string, options?: WebExtractOptions): Promise<WebExtractResult>;
  crawl?(url: string, options?: WebCrawlOptions): Promise<WebCrawlResult>;
};

export type WebResearchProviderContext = {
  config: WebResearchConfig;
  fetch: WebResearchFetch;
  credentialResolver: WebResearchCredentialResolver;
};

export type WebResearchConfig = {
  backend?: string;
  searchBackend?: string;
  extractBackend?: string;
  crawlBackend?: string;
  brave?: {
    apiKeyEnv?: string;
  };
};

export function defaultWebResearchFetch(): WebResearchFetch {
  return async (url, init) => {
    if (globalThis.fetch === undefined) {
      throw new Error("fetch is not available in this runtime.");
    }
    return globalThis.fetch(url, init);
  };
}

export function defaultWebResearchCredentialResolver(): WebResearchCredentialResolver {
  return resolveRuntimeCredential;
}
