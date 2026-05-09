import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import type { RegisteredTool, ToolResult } from "../contracts/tool.js";
import type { ResolvedModelRoute } from "../contracts/provider.js";
import type { ProviderExecutor } from "../providers/provider-executor.js";

export type VisionToolOptions = {
  workspaceRoot: string;
  allowedRoots?: string[];
  resolvedVisionRoute?: ResolvedModelRoute;
  mainRoute?: ResolvedModelRoute;
  fallbackToMain?: boolean;
  providerExecutor?: ProviderExecutor;
  maxImageBytes?: number;
};

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ResolvedPath =
  | { ok: true; path: string; root?: string }
  | { ok: false; content: string; metadata?: Record<string, unknown> };

export function createVisionTools(options: VisionToolOptions): readonly RegisteredTool[] {
  const workspaceRoot = resolve(options.workspaceRoot);
  const allowedRoots = dedupeRoots([workspaceRoot, ...(options.allowedRoots ?? [])]);

  return [
    {
      name: "vision.analyze",
      description: "Analyze an image with the best available vision-capable model route.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          prompt: { type: "string" }
        },
        required: ["path"]
      },
      riskClass: "read-only-local",
      toolsets: ["media", "research", "telegram", "core"],
      progressLabel: "analyzing image",
      maxResultSizeChars: 8_000,
      isAvailable: async () => options.resolvedVisionRoute !== undefined,
      run: (input: { path?: string; prompt?: string }, context) => analyzeImageWithVision(options, input, context?.signal)
    }
  ];
}

export async function analyzeImageWithVision(
  options: VisionToolOptions,
  input: { path?: string; prompt?: string },
  signal?: AbortSignal
): Promise<ToolResult> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const allowedRoots = dedupeRoots([workspaceRoot, ...(options.allowedRoots ?? [])]);
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const resolved = await resolveAllowedPath(allowedRoots, input.path);
  if (!resolved.ok) {
    return resolved;
  }

  const fileStat = await stat(resolved.path);
  if (fileStat.size > maxImageBytes) {
    return {
      ok: false,
      content: `This image is too large for the current vision workflow. The limit is ${formatBytes(maxImageBytes)}.`,
      metadata: {
        bytes: fileStat.size,
        limitBytes: maxImageBytes
      }
    };
  }

  const mimeType = inferImageMimeType(resolved.path);
  if (mimeType === undefined) {
    return {
      ok: false,
      content: "This file does not look like a supported image for vision analysis.",
      metadata: {
        path: resolved.path
      }
    };
  }

  if (options.resolvedVisionRoute === undefined) {
    return {
      ok: false,
      content: "No vision-capable provider route is configured and available in this runtime yet."
    };
  }

  const imageBytes = await readFile(resolved.path);
  const dataUrl = `data:${mimeType};base64,${imageBytes.toString("base64")}`;
  const displayRoot = resolved.root ?? workspaceRoot;
  const relativePath = makeRelativePath(displayRoot, resolved.path);
  const attempts: string[] = [];

  const visionResult = await executeVisionRequest({
    route: options.resolvedVisionRoute,
    dataUrl,
    prompt: input.prompt,
    providerExecutor: options.providerExecutor,
    signal
  });

  attempts.push(visionResult.attempt);

  if (visionResult.ok) {
    return {
      ok: true,
      content: [
        `Vision analysis: ${relativePath}`,
        visionResult.content.trim()
      ].filter((line) => line.length > 0).join("\n\n"),
      metadata: {
        path: relativePath,
        bytes: fileStat.size,
        mimeType,
        provider: visionResult.provider,
        model: visionResult.model,
        attempts
      }
    };
  }

  // Fallback to main if allowed and main supports vision
  if (
    options.fallbackToMain === true &&
    options.mainRoute !== undefined &&
    options.mainRoute.profile.supportsVision &&
    options.providerExecutor !== undefined
  ) {
    const fallbackResult = await executeVisionRequest({
      route: options.mainRoute,
      dataUrl,
      prompt: input.prompt,
      providerExecutor: options.providerExecutor,
      signal
    });

    attempts.push(fallbackResult.attempt);

    if (fallbackResult.ok) {
      return {
        ok: true,
        content: [
          `Vision analysis: ${relativePath}`,
          fallbackResult.content.trim()
        ].filter((line) => line.length > 0).join("\n\n"),
        metadata: {
          path: relativePath,
          bytes: fileStat.size,
          mimeType,
          provider: fallbackResult.provider,
          model: fallbackResult.model,
          attempts
        }
      };
    }
  }

  return {
    ok: false,
    content: `Vision analysis is unavailable right now. Attempts: ${attempts.join(", ") || "none"}`,
    metadata: {
      path: relativePath,
      bytes: fileStat.size,
      mimeType,
      attempts
    }
  };
}

async function executeVisionRequest(options: {
  route: ResolvedModelRoute;
  dataUrl: string;
  prompt?: string;
  providerExecutor?: ProviderExecutor;
  signal?: AbortSignal;
}): Promise<{
  ok: boolean;
  content: string;
  provider: string;
  model: string;
  attempt: string;
}> {
  if (options.providerExecutor === undefined) {
    return {
      ok: false,
      content: "",
      provider: options.route.provider,
      model: options.route.id,
      attempt: `${options.route.provider}/${options.route.id}:no-executor`
    };
  }

  const result = await options.providerExecutor.complete({
    model: options.route.id,
    messages: [
      {
        role: "system",
        content: "You are EstaCoda's vision analysis lane. Describe the image directly and concretely. Mention visible text if present. Stay concise but useful."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: options.prompt?.trim().length
              ? options.prompt.trim()
              : "Describe this image so EstaCoda can help the user."
          },
          {
            type: "image_url",
            image_url: {
              url: options.dataUrl
            }
          }
        ]
      }
    ] as any,
    maxTokens: 500
  }, {}, {
    primaryRoute: options.route,
    signal: options.signal
  });

  if (result.ok && result.response !== undefined) {
    return {
      ok: true,
      content: result.response.content,
      provider: result.response.provider,
      model: result.response.model,
      attempt: `${result.response.provider}/${result.response.model}:ok`
    };
  }

  const lastAttempt = result.attempts[result.attempts.length - 1];
  return {
    ok: false,
    content: "",
    provider: options.route.provider,
    model: options.route.id,
    attempt: `${options.route.provider}/${options.route.id}:${lastAttempt?.errorClass ?? "error"}`
  };
}

async function resolveAllowedPath(roots: string[], path: string | undefined): Promise<ResolvedPath> {
  if (typeof path !== "string" || path.length === 0) {
    return errorResult("path must be a non-empty string");
  }

  for (const root of roots) {
    const candidate = resolve(root, path);
    const canonicalRoot = await realpath(root).catch(() => root);
    const canonical = await realpath(candidate).catch(() => undefined);

    if (canonical === undefined) {
      continue;
    }

    if (canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}/`)) {
      return {
        ok: true,
        path: canonical,
        root: canonicalRoot
      };
    }
  }

  return errorResult("path is outside the trusted workspace");
}

function inferImageMimeType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return undefined;
  }
}

function dedupeRoots(roots: string[]): string[] {
  return [...new Set(roots.map((root) => resolve(root)))];
}

function makeRelativePath(root: string, path: string): string {
  const relativePath = path.startsWith(root) ? path.slice(root.length).replace(/^\/+/u, "") : path;
  return relativePath.length > 0 ? relativePath : path;
}

function errorResult(content: string): ResolvedPath {
  return {
    ok: false,
    content
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}
