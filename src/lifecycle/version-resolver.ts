import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type VersionInfo = {
  current: string;
  latest: string;
  releaseNotesUrl: string;
  breakingChanges: boolean;
};

export type VersionResolverResult =
  | { ok: true; info: VersionInfo }
  | { ok: false; error: string };

const GITHUB_API_LATEST = "https://api.github.com/repos/kemetresearch/estacoda/releases/latest";

export async function getLocalVersion(): Promise<string> {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const packagePath = join(dirname(modulePath), "..", "..", "package.json");
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function resolveLatestVersion(fetchFn?: typeof fetch): Promise<VersionResolverResult> {
  const current = await getLocalVersion();
  const fetchLike = fetchFn ?? globalThis.fetch;

  try {
    const response = await fetchLike(GITHUB_API_LATEST, {
      headers: { "User-Agent": "estacoda-version-resolver" }
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Release check failed: HTTP ${response.status}`
      };
    }

    const data = await response.json() as {
      tag_name?: string;
      html_url?: string;
      body?: string;
    };

    const latest = normalizeTagVersion(data.tag_name ?? "0.0.0");
    const breakingChanges = detectBreakingChanges(data.body ?? "");

    return {
      ok: true,
      info: {
        current,
        latest,
        releaseNotesUrl: data.html_url ?? GITHUB_API_LATEST,
        breakingChanges
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Release check failed: ${message}`
    };
  }
}

function normalizeTagVersion(tag: string): string {
  return tag.replace(/^v/, "");
}

function detectBreakingChanges(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("breaking change") || lower.includes("breaking:");
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const maxLen = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < maxLen; i++) {
    const a = leftParts[i] ?? 0;
    const b = rightParts[i] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
}
