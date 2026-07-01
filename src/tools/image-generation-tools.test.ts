import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    process.env.FAL_KEY = "fal-secret";
    process.env.OPENAI_API_KEY = "openai-secret";
  });

  afterEach(async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    delete process.env.FAL_KEY;
    delete process.env.OPENAI_API_KEY;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("builds FAL generation payloads from the catalog and resolves aliases", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        images: [{ url: "https://images.example/fal-generated.png" }],
        seed: 777
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-fal" }),
      imageGen: falImageGen(),
      fetch: fetcher,
      id: () => "fal-generated"
    })[0]!;

    const result = await tool.run({
      prompt: "draw clean neon wayfinding",
      aspectRatio: "landscape",
      model: "flux-2-pro",
      seed: 12345
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Seed: 777");
    expect(requests[0]?.url).toBe("https://fal.run/fal-ai/flux-2-pro");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Key fal-secret",
      "content-type": "application/json"
    });
    expect(jsonBody(requests[0]?.init)).toEqual({
      prompt: "draw clean neon wayfinding",
      image_size: "landscape_16_9",
      num_inference_steps: 50,
      guidance_scale: 4.5,
      num_images: 1,
      output_format: "png",
      enable_safety_checker: false,
      safety_tolerance: "5",
      sync_mode: true,
      seed: 12345
    });
  });

  it("builds FAL aspect-ratio model payloads from the catalog", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ images: [{ url: "https://images.example/krea.png" }] });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-krea" }),
      imageGen: falImageGen(),
      fetch: fetcher,
      id: () => "krea"
    })[0]!;

    const result = await tool.run({
      prompt: "paint a cinematic product scene",
      aspectRatio: "portrait",
      model: "krea-2-large"
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe("https://fal.run/fal-ai/krea/v2/large/text-to-image");
    expect(jsonBody(requests[0]?.init)).toEqual({
      prompt: "paint a cinematic product scene",
      aspect_ratio: "9:16",
      creativity: "medium"
    });
  });

  it("builds FAL literal-size model payloads from the catalog", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ images: [{ url: "https://images.example/gpt.png" }] });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-gpt" }),
      imageGen: falImageGen(),
      fetch: fetcher,
      id: () => "gpt"
    })[0]!;

    const result = await tool.run({
      prompt: "make an editorial poster",
      aspectRatio: "square",
      model: "gpt-image-1.5"
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe("https://fal.run/fal-ai/gpt-image-1.5");
    expect(jsonBody(requests[0]?.init)).toEqual({
      prompt: "make an editorial poster",
      image_size: "1024x1024",
      quality: "medium",
      num_images: 1,
      output_format: "png"
    });
  });

  it("stores FAL sync-mode data URI images without a second download", async () => {
    const imageBytes = Buffer.from("fal-sync-png");
    const requests: string[] = [];
    const fetcher: ImageGenerationFetchLike = async (url) => {
      requests.push(url);
      return jsonResponse({
        images: [{ url: `data:image/png;base64,${imageBytes.toString("base64")}` }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-fal-sync" }),
      imageGen: falImageGen("fal-ai/flux-2-pro"),
      fetch: fetcher,
      id: () => "fal-sync"
    })[0]!;

    const result = await tool.run({
      prompt: "draw an illuminated sign",
      model: "flux-2-pro"
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual(["https://fal.run/fal-ai/flux-2-pro"]);
    await expect(readFile(join(tempDir, "fal-sync.png"))).resolves.toEqual(imageBytes);
  });

  it("sends FAL edit payloads to cataloged edit endpoints", async () => {
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        images: [{ url: "https://images.example/fal-edited.png" }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-fal-edit" }),
      imageGen: falImageGen("fal-ai/flux-2-pro"),
      fetch: fetcher,
      id: () => "fal-edit"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "add realistic flames above the cup",
      sourceImages: ["https://images.example/cup.png"]
    });

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://fal.run/fal-ai/flux-2-pro/edit");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Key fal-secret",
      "content-type": "application/json"
    });
    expect(jsonBody(requests[0]?.init)).toEqual({
      prompt: "add realistic flames above the cup",
      image_urls: ["https://images.example/cup.png"],
      num_inference_steps: 50,
      guidance_scale: 4.5,
      num_images: 1,
      output_format: "png",
      enable_safety_checker: false,
      safety_tolerance: "5",
      sync_mode: true
    });
  });

  it("rejects FAL image edits for models without a cataloged edit endpoint", async () => {
    const requests: string[] = [];
    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-fal-no-edit" }),
      imageGen: falImageGen("fal-ai/z-image/turbo"),
      fetch: async (url) => {
        requests.push(url);
        return jsonResponse({ images: [{ url: "https://images.example/edit.png" }] });
      },
      id: () => "fal-no-edit"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "change the background",
      sourceImages: ["https://images.example/source.png"]
    });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("does not have a cataloged image editing endpoint");
    expect(requests).toEqual([]);
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
    expect(jsonBody(requests[0]?.init)).toEqual({
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
    expect(jsonBody(requests[0]?.init)).toEqual({
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
    expect(jsonBody(requests[0]?.init)).toMatchObject({
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

  it("sends OpenAI generation payloads with virtual GPT Image 2 quality tiers", async () => {
    const imageBytes = Buffer.from("openai-png");
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        data: [{ b64_json: imageBytes.toString("base64") }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-openai" }),
      imageGen: openAIImageGen(),
      fetch: fetcher,
      id: () => "openai-generated"
    })[0]!;

    const result = await tool.run({
      prompt: "draw a crisp product label",
      aspectRatio: "landscape",
      model: "high",
      seed: 12345
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Model: gpt-image-2-high");
    expect(result.content).not.toContain("Seed:");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer openai-secret",
      "content-type": "application/json"
    });
    expect(jsonBody(requests[0]?.init)).toEqual({
      model: "gpt-image-2",
      prompt: "draw a crisp product label",
      size: "1536x1024",
      n: 1,
      quality: "high"
    });
    await expect(readFile(join(tempDir, "openai-generated.png"))).resolves.toEqual(imageBytes);
  });

  it("sends OpenAI edit multipart payloads with downloaded HTTPS source images", async () => {
    const sourceBytes = Buffer.from("source-png");
    const editedBytes = Buffer.from("openai-edited-png");
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      if (url === "https://images.example/source.png") {
        return binaryResponse(sourceBytes, "image/png");
      }
      return jsonResponse({
        data: [{ b64_json: editedBytes.toString("base64") }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-openai-edit" }),
      imageGen: openAIImageGen(),
      fetch: fetcher,
      id: () => "openai-edit"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "change the background to polished marble",
      sourceImages: ["https://images.example/source.png"],
      aspectRatio: "portrait",
      model: "low"
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Model: gpt-image-2-low");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://images.example/source.png");
    expect(requests[1]?.url).toBe("https://api.openai.com/v1/images/edits");
    expect(requests[1]?.init?.headers).toEqual({
      authorization: "Bearer openai-secret"
    });
    const form = requests[1]?.init?.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("model")).toBe("gpt-image-2");
    expect((form as FormData).get("prompt")).toBe("change the background to polished marble");
    expect((form as FormData).get("size")).toBe("1024x1536");
    expect((form as FormData).get("n")).toBe("1");
    expect((form as FormData).get("quality")).toBe("low");
    const imageParts = (form as FormData).getAll("image[]");
    expect(imageParts).toHaveLength(1);
    expect(Buffer.from(await (imageParts[0] as Blob).arrayBuffer())).toEqual(sourceBytes);
    await expect(readFile(join(tempDir, "openai-edit.png"))).resolves.toEqual(editedBytes);
  });

  it("sends OpenAI edit multipart payloads from local image artifacts in the image cache", async () => {
    const sourceBytes = Buffer.from("cached-source-png");
    const editedBytes = Buffer.from("cached-edited-png");
    const sourcePath = join(tempDir, "source.png");
    await writeFile(sourcePath, sourceBytes);
    const ids = ["source-artifact", "edited-artifact"];
    const artifactStore = new ArtifactStore({ id: () => ids.shift() ?? "artifact" });
    artifactStore.record({
      path: sourcePath,
      kind: "image",
      bytes: sourceBytes.byteLength,
      mimeType: "image/png"
    });
    const requests: Array<{ url: string; init?: Parameters<ImageGenerationFetchLike>[1] }> = [];
    const fetcher: ImageGenerationFetchLike = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        data: [{ b64_json: editedBytes.toString("base64") }]
      });
    };

    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore,
      imageGen: openAIImageGen(),
      fetch: fetcher,
      id: () => "openai-cached-edit"
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "add a tasteful gold border",
      sourceImages: ["artifact://source-artifact"]
    });

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/images/edits");
    const form = requests[0]?.init?.body as FormData;
    const imageParts = form.getAll("image[]");
    expect(imageParts).toHaveLength(1);
    expect(Buffer.from(await (imageParts[0] as Blob).arrayBuffer())).toEqual(sourceBytes);
    await expect(readFile(join(tempDir, "openai-cached-edit.png"))).resolves.toEqual(editedBytes);
  });

  it("rejects OpenAI local image artifacts outside the image cache before calling the provider", async () => {
    const sourceBytes = Buffer.from("outside-cache-png");
    const imageCacheRoot = join(tempDir, "cache");
    const sourcePath = join(tempDir, "outside-cache.png");
    await writeFile(sourcePath, sourceBytes);
    const artifactStore = new ArtifactStore({ id: () => "outside-source" });
    artifactStore.record({
      path: sourcePath,
      kind: "image",
      bytes: sourceBytes.byteLength,
      mimeType: "image/png"
    });
    const requests: string[] = [];
    const tool = createImageGenerationTools({
      imageCacheRoot,
      artifactStore,
      imageGen: openAIImageGen(),
      fetch: async (url) => {
        requests.push(url);
        return jsonResponse({ data: [] });
      }
    }).find((candidate) => candidate.name === "image.edit")!;

    const result = await tool.run({
      prompt: "add a tasteful gold border",
      sourceImages: ["artifact://outside-source"]
    });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("selected profile image cache");
    expect(requests).toEqual([]);
  });

  it("reports setup-needed metadata for OpenAI image edits with the edit resume intent", async () => {
    delete process.env.OPENAI_API_KEY;
    const requests: string[] = [];
    const tool = createImageGenerationTools({
      imageCacheRoot: tempDir,
      artifactStore: new ArtifactStore({ id: () => "artifact-openai-missing-key" }),
      imageGen: openAIImageGen(),
      fetch: async (url) => {
        requests.push(url);
        return jsonResponse({ data: [] });
      },
      id: () => "openai-missing-key"
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
      requiredSecret: "OPENAI_API_KEY"
    });
    expect(requests).toEqual([]);
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

function falImageGen(model = "fal-ai/flux-2/klein/9b"): LoadedRuntimeConfig["imageGen"] {
  return {
    provider: "fal",
    model,
    useGateway: false,
    apiKeyEnv: "FAL_KEY",
    baseUrl: "https://fal.run",
    fal: {
      model,
      apiKeyEnv: "FAL_KEY",
      baseUrl: "https://fal.run"
    }
  };
}

function openAIImageGen(model = "gpt-image-2-medium"): LoadedRuntimeConfig["imageGen"] {
  return {
    provider: "openai",
    model,
    useGateway: false,
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    openai: {
      model,
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1"
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
    arrayBuffer: async () => bufferToArrayBuffer(bytes),
    text: async () => raw
  };
}

function binaryResponse(bytes: Buffer, contentType: string): Awaited<ReturnType<ImageGenerationFetchLike>> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => bufferToArrayBuffer(bytes),
    text: async () => bytes.toString("utf8")
  };
}

function jsonBody(init: Parameters<ImageGenerationFetchLike>[1] | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new TypeError("Expected JSON request body.");
  }
  return JSON.parse(init.body);
}

function bufferToArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
