import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALLOWED_ENV_KEYS = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "SHELL",
  "TERM",
  "USER",
  "LOGNAME",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "PATHEXT"
];

const RESERVED_ENV_KEYS = new Set([
  "HOME",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "ESTACODA_INPUT_JSON",
  "ESTACODA_ALLOWED_TOOLS_JSON"
]);

export type SafeChildEnvOptions = {
  /** Explicit sandbox home directory. If omitted, a fresh temp directory is created. */
  homeDir?: string;
  /** Extra environment variables to merge intentionally and narrowly on top of the allowlist. */
  extra?: Record<string, string>;
};

/**
 * Build a sanitized subprocess environment.
 *
 * - Only allowed runtime variables (PATH, TMPDIR, LANG, etc.) are inherited from the parent.
 * - HOME is always set to an isolated sandbox directory, never the real user HOME.
 * - Explicit `extra` values are merged intentionally and narrowly, but reserved keys
 *   (HOME, PATH, TMPDIR, TMP, TEMP, ESTACODA_INPUT_JSON, ESTACODA_ALLOWED_TOOLS_JSON)
 *   cannot be overridden by extra.
 * - If the parent has no temp environment variables, TMPDIR is set to a safe fallback.
 * - Parent secrets, tokens, and all other env vars are never forwarded.
 */
export function buildSafeChildEnv(options?: SafeChildEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  // Fallback: ensure temp directory is available even if parent has no temp env.
  if (!env["TMPDIR"] && !env["TMP"] && !env["TEMP"]) {
    env["TMPDIR"] = tmpdir();
  }

  if (options?.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      if (!RESERVED_ENV_KEYS.has(key)) {
        env[key] = value;
      }
    }
  }

  env["HOME"] = options?.homeDir ?? mkdtempSync(join(tmpdir(), "estacoda-sandbox-home-"));

  return env;
}
