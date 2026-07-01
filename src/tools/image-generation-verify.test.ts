import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import { verifyImageGeneration } from "./image-generation-verify.js";
import type { ImageGenerationFetchLike } from "./image-generation-tools.js";

describe("verifyImageGeneration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-image-verify-"));
    process.env.BYTEPLUS_ARK_API_KEY = "byteplus-secret";
    process.env.FAL_KEY = "fal-secret";
  });

  afterEach(async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    delete process.env.FAL_KEY;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not treat a missing BytePlus probe endpoint as ready", async () => {
    const fetcher: ImageGenerationFetchLike = async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => ""
    });

    const result = await verifyImageGeneration({
      imageGen: bytePlusImageGen(),
      homeDir: tempDir,
      workspaceRoot: tempDir,
      fetch: fetcher
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Provider capability check endpoint was not found: 404 Not Found");
  });

  it("checks FAL credentials against the platform models endpoint", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => JSON.stringify({ models: [] })
      };
    };

    const result = await verifyImageGeneration({
      imageGen: falImageGen(),
      homeDir: tempDir,
      workspaceRoot: tempDir,
      fetch: fetcher
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual([{
      url: "https://api.fal.ai/v1/models?limit=1",
      init: {
        method: "GET",
        headers: {
          authorization: "Key fal-secret"
        }
      }
    }]);
  });
});

function bytePlusImageGen(): LoadedRuntimeConfig["imageGen"] {
  return {
    provider: "byteplus",
    model: "seedream-5-0-260128",
    useGateway: false,
    apiKeyEnv: "BYTEPLUS_ARK_API_KEY",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3",
    byteplus: {
      model: "seedream-5-0-260128",
      apiKeyEnv: "BYTEPLUS_ARK_API_KEY",
      baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3"
    }
  };
}

function falImageGen(): LoadedRuntimeConfig["imageGen"] {
  return {
    provider: "fal",
    model: "fal-ai/flux-2/klein/9b",
    useGateway: false,
    apiKeyEnv: "FAL_KEY",
    baseUrl: "https://fal.run",
    fal: {
      model: "fal-ai/flux-2/klein/9b",
      apiKeyEnv: "FAL_KEY",
      baseUrl: "https://fal.run"
    }
  };
}
