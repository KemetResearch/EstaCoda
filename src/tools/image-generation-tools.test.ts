import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import { createImageGenerationTools, type ImageGenerationFetchLike } from "./image-generation-tools.js";

describe("image generation tools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-image-generation-"));
    process.env.BYTEPLUS_ARK_API_KEY = "byteplus-secret";
  });

  afterEach(async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("sends documented BytePlus payload fields and resolves friendly model aliases", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        data: [{ url: "https://images.example/generated.png" }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-1" }),
      imageGen: bytePlusImageGen(),
      fetch: fetcher,
      id: () => "generated"
    })[0]!;

    const result = await tool.run({
      prompt: "draw a brass astrolabe",
      aspectRatio: "landscape",
      model: "seedream-5",
      seed: 12345
    });

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer byteplus-secret",
      "content-type": "application/json"
    });
    expect(JSON.parse(requests[0]?.init?.body ?? "{}")).toEqual({
      model: "seedream-5-0-260128",
      prompt: "draw a brass astrolabe",
      size: "2560x1440",
      output_format: "png",
      response_format: "url",
      watermark: false
    });
  });

  it("stores BytePlus b64_json responses without a second image download", async () => {
    const imageBytes = Buffer.from("fake-png-bytes");
    const requests: string[] = [];
    const fetcher: ImageGenerationFetchLike = async (url) => {
      requests.push(url);
      return jsonResponse({
        data: [{ b64_json: imageBytes.toString("base64") }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-2" }),
      imageGen: bytePlusImageGen(),
      fetch: fetcher,
      id: () => "b64"
    })[0]!;

    const result = await tool.run({
      prompt: "draw a lapis tile",
      aspectRatio: "square"
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual(["https://ark.ap-southeast.bytepluses.com/api/v3/images/generations"]);
    await expect(readFile(join(tempDir, "b64.png"))).resolves.toEqual(imageBytes);
  });

  it("sends documented BytePlus edit payload with a single source image URL", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        data: [{ url: "https://images.example/edited.png" }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-edit" }),
      imageGen: bytePlusImageGen(),
      fetch: fetcher,
      id: () => "edited"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "change the dress material to clear water",
      sourceImages: ["https://images.example/source.png"],
      aspectRatio: "portrait",
      model: "seedream-5"
    });

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer byteplus-secret",
      "content-type": "application/json"
    });
    expect(JSON.parse(requests[0]?.init?.body ?? "{}")).toEqual({
      model: "seedream-5-0-260128",
      prompt: "change the dress material to clear water",
      image: "https://images.example/source.png",
      sequential_image_generation: "disabled",
      size: "1440x2560",
      output_format: "png",
      response_format: "url",
      watermark: false
    });
  });

  it("resolves BytePlus edit source images from generated artifact source URLs", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        data: [{ b64_json: Buffer.from("edited-png").toString("base64") }]
      });
    };
    const ids = ["source-artifact", "edited-artifact"];
    const artifactStore = new ArtifactStore({ id: () => ids.shift() ?? "artifact" });
    artifactStore.record({
      path: "artifact://source-artifact",
      kind: "image",
      bytes: 12,
      mimeType: "image/png",
      metadata: {
        sourceUrl: "https://images.example/generated-source.png"
      }
    });

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore,
      imageGen: bytePlusImageGen(),
      fetch: fetcher,
      id: () => "edited-b64"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "replace the outfit",
      sourceImages: ["artifact://source-artifact"]
    });

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]?.init?.body ?? "{}")).toMatchObject({
      image: "https://images.example/generated-source.png",
      sequential_image_generation: "disabled"
    });
    await expect(readFile(join(tempDir, "edited-b64.png"))).resolves.toEqual(Buffer.from("edited-png"));
  });

  it("rejects local source image paths before calling BytePlus edit", async () => {
    const requests: string[] = [];
    const fetcher: ImageGenerationFetchLike = async (url) => {
      requests.push(url);
      return jsonResponse({
        data: [{ url: "https://images.example/edited.png" }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-local" }),
      imageGen: bytePlusImageGen(),
      fetch: fetcher,
      id: () => "edited-local"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "change the background",
      sourceImages: [join(tempDir, "local.png")]
    });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("safe HTTPS URLs");
    expect(requests).toEqual([]);
  });

  it("reports setup-needed metadata for BytePlus image edits with the edit resume intent", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-missing-key" }),
      imageGen: bytePlusImageGen(),
      fetch: async () => jsonResponse({ data: [] }),
      id: () => "edited-missing-key"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "change the background",
      sourceImages: ["https://images.example/source.png"]
    });

    expect(result.ok).toBe(false);
    expect(result.metadata).toMatchObject({
      kind: "setup_needed",
      capability: "image_generation",
      resumeIntent: "image.edit",
      requiredSecret: "BYTEPLUS_ARK_API_KEY"
    });
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

function jsonResponse(value: unknown): Awaited<ReturnType<ImageGenerationFetchLike>> {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const bytes = Buffer.from("downloaded-image");
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "image/png" },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => raw
  };
}
