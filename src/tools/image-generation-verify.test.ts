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
  });

  afterEach(async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
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
