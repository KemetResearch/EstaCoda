import { join } from "node:path";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import type { ImageGenerationFetchLike } from "./image-generation-tools.js";

export type ImageGenerationVerification = {
  ok: boolean;
  provider: "fal" | "byteplus";
  model: string;
  apiKeyEnv: string;
  apiKeyPresent: boolean;
  check: "skipped" | "request";
  message: string;
  cachePath: string;
  telegramDelivery: "ready" | "not-configured";
};

export async function verifyImageGeneration(options: {
  config: LoadedRuntimeConfig;
  homeDir?: string;
  workspaceRoot: string;
  fetch?: ImageGenerationFetchLike;
  checkProvider?: boolean;
}): Promise<ImageGenerationVerification> {
  const provider = options.config.imageGen.provider;
  const model = options.config.imageGen.model;
  const apiKeyEnv = provider === "byteplus"
    ? options.config.imageGen.byteplus?.apiKeyEnv ?? "BYTEPLUS_ARK_API_KEY"
    : options.config.imageGen.fal?.apiKeyEnv ?? "FAL_KEY";
  const apiKeyPresent = (process.env[apiKeyEnv] ?? "").length > 0;
  const cachePath = join(options.homeDir ?? process.env.HOME ?? options.workspaceRoot, ".estacoda", "image-cache");
  const telegramDelivery = options.config.channels.telegram.ready ? "ready" : "not-configured";

  if (!apiKeyPresent) {
    return {
      ok: false,
      provider,
      model,
      apiKeyEnv,
      apiKeyPresent,
      check: "skipped",
      message: `Missing API key environment variable: ${apiKeyEnv}`,
      cachePath,
      telegramDelivery
    };
  }

  if (options.checkProvider === false) {
    return {
      ok: true,
      provider,
      model,
      apiKeyEnv,
      apiKeyPresent,
      check: "skipped",
      message: "Configuration and API key are present.",
      cachePath,
      telegramDelivery
    };
  }

  const fetcher = options.fetch ?? globalImageVerifyFetch;
  const result = await (provider === "byteplus"
    ? verifyBytePlus(options.config, fetcher)
    : verifyFal(options.config, fetcher));
  return {
    ok: result.ok,
    provider,
    model,
    apiKeyEnv,
    apiKeyPresent,
    check: "request",
    message: result.message,
    cachePath,
    telegramDelivery
  };
}

async function verifyFal(config: LoadedRuntimeConfig, fetcher: ImageGenerationFetchLike): Promise<{ ok: boolean; message: string }> {
  const apiKeyEnv = config.imageGen.fal?.apiKeyEnv ?? "FAL_KEY";
  const apiKey = process.env[apiKeyEnv] ?? "";
  const baseUrl = (config.imageGen.fal?.baseUrl ?? config.imageGen.baseUrl ?? "https://fal.run").replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/${config.imageGen.model}`, {
    method: "GET",
    headers: {
      authorization: `Key ${apiKey}`
    }
  });

  return interpretSafeProviderProbe(response);
}

async function verifyBytePlus(config: LoadedRuntimeConfig, fetcher: ImageGenerationFetchLike): Promise<{ ok: boolean; message: string }> {
  const apiKeyEnv = config.imageGen.byteplus?.apiKeyEnv ?? "BYTEPLUS_ARK_API_KEY";
  const apiKey = process.env[apiKeyEnv] ?? "";
  const baseUrl = (config.imageGen.byteplus?.baseUrl ?? config.imageGen.baseUrl ?? "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  return interpretSafeProviderProbe(response);
}

function interpretSafeProviderProbe(response: Awaited<ReturnType<ImageGenerationFetchLike>>): { ok: boolean; message: string } {
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message: `Provider authentication failed: ${response.status} ${response.statusText}`
    };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      message: `Provider endpoint is not reachable: ${response.status} ${response.statusText}`
    };
  }
  return {
    ok: true,
    message: response.ok ? "Provider capability check passed." : `Provider endpoint reachable (${response.status} ${response.statusText}).`
  };
}

async function globalImageVerifyFetch(url: string, init?: Parameters<ImageGenerationFetchLike>[1]): ReturnType<ImageGenerationFetchLike> {
  try {
    const response = await fetch(url, init as RequestInit);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      arrayBuffer: async () => await response.arrayBuffer(),
      text: async () => await response.text()
    };
  } catch (error) {
    return {
      ok: false,
      status: 599,
      statusText: error instanceof Error ? error.message : "Network error",
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => ""
    };
  }
}
