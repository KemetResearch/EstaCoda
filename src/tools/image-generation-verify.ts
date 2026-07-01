import type { ImageGenerationProvider, LoadedRuntimeConfig } from "../config/runtime-config.js";
import { resolveHomeDir } from "../config/home-dir.js";
import { defaultProfileId, readActiveProfile, resolveProfileStateHome } from "../config/profile-home.js";
import { defaultImageApiKeyEnv, defaultImageBaseUrl, defaultImageModel } from "../contracts/image-generation.js";
import type { ImageGenerationFetchLike } from "./image-generation-tools.js";

export type ImageGenerationVerification = {
  ok: boolean;
  provider: ImageGenerationProvider;
  model: string;
  apiKeyEnv: string;
  apiKeyPresent: boolean;
  check: "skipped" | "request";
  message: string;
  cachePath: string;
  telegramDelivery: "ready" | "not-configured";
};

export async function verifyImageGeneration(options: {
  imageGen: LoadedRuntimeConfig["imageGen"];
  telegramReady?: boolean;
  homeDir?: string;
  imageCachePath?: string;
  workspaceRoot: string;
  fetch?: ImageGenerationFetchLike;
  checkProvider?: boolean;
}): Promise<ImageGenerationVerification> {
  const provider = options.imageGen.provider;
  const model = options.imageGen.model;
  const apiKeyEnv = imageProviderApiKeyEnv(options.imageGen, provider);
  const apiKeyPresent = (process.env[apiKeyEnv] ?? "").length > 0;
  const homeDir = resolveHomeDir(options.homeDir);
  const profileId = readActiveProfile({ homeDir }).profileId ?? defaultProfileId();
  const cachePath = options.imageCachePath ?? resolveProfileStateHome({ homeDir, profileId }).imageCachePath;
  const telegramDelivery = options.telegramReady === true ? "ready" : "not-configured";

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
    ? verifyBytePlus(options.imageGen, fetcher)
    : provider === "openai"
      ? verifyOpenAI(options.imageGen, fetcher)
      : verifyFal(options.imageGen, fetcher));
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

function imageProviderApiKeyEnv(imageGen: LoadedRuntimeConfig["imageGen"], provider: ImageGenerationProvider): string {
  if (provider === "byteplus") return imageGen.byteplus?.apiKeyEnv ?? defaultImageApiKeyEnv("byteplus");
  if (provider === "openai") return imageGen.openai?.apiKeyEnv ?? defaultImageApiKeyEnv("openai");
  return imageGen.fal?.apiKeyEnv ?? defaultImageApiKeyEnv("fal");
}

async function verifyFal(imageGen: LoadedRuntimeConfig["imageGen"], fetcher: ImageGenerationFetchLike): Promise<{ ok: boolean; message: string }> {
  const apiKeyEnv = imageGen.fal?.apiKeyEnv ?? defaultImageApiKeyEnv("fal");
  const apiKey = process.env[apiKeyEnv] ?? "";
  const response = await fetcher("https://api.fal.ai/v1/models?limit=1", {
    method: "GET",
    headers: {
      authorization: `Key ${apiKey}`
    }
  });

  return interpretSafeProviderProbe(response);
}

async function verifyBytePlus(imageGen: LoadedRuntimeConfig["imageGen"], fetcher: ImageGenerationFetchLike): Promise<{ ok: boolean; message: string }> {
  const apiKeyEnv = imageGen.byteplus?.apiKeyEnv ?? defaultImageApiKeyEnv("byteplus");
  const apiKey = process.env[apiKeyEnv] ?? "";
  const baseUrl = (imageGen.byteplus?.baseUrl ?? imageGen.baseUrl ?? defaultImageBaseUrl("byteplus")).replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  return interpretSafeProviderProbe(response);
}

async function verifyOpenAI(imageGen: LoadedRuntimeConfig["imageGen"], fetcher: ImageGenerationFetchLike): Promise<{ ok: boolean; message: string }> {
  const apiKeyEnv = imageGen.openai?.apiKeyEnv ?? defaultImageApiKeyEnv("openai");
  const apiKey = process.env[apiKeyEnv] ?? "";
  const baseUrl = (imageGen.openai?.baseUrl ?? imageGen.baseUrl ?? defaultImageBaseUrl("openai")).replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/models/gpt-image-2`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  return interpretSafeProviderProbe(response);
}

export function defaultImageGenerationConfig(input?: {
  provider?: ImageGenerationProvider;
  model?: string;
  apiKeyEnv?: string;
}): LoadedRuntimeConfig["imageGen"] {
  const provider = input?.provider ?? "fal";
  const model = input?.model ?? defaultImageModel(provider);
  const apiKeyEnv = input?.apiKeyEnv ?? defaultImageApiKeyEnv(provider);
  return {
    provider,
    model,
    useGateway: false,
    [provider]: {
      model,
      apiKeyEnv
    }
  };
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
  if (response.status === 404) {
    return {
      ok: false,
      message: `Provider capability check endpoint was not found: ${response.status} ${response.statusText}`
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
