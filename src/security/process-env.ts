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
 * - Explicit `extra` values are merged intentionally and narrowly.
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

  env["HOME"] = options?.homeDir ?? mkdtempSync(join(tmpdir(), "estacoda-sandbox-home-"));

  if (options?.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      env[key] = value;
    }
  }

  return env;
}
