import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProfileStateHome } from "../config/profile-home.js";
import { ensureProfileSkeleton } from "./profile-state.js";

const require = createRequire(import.meta.url);
const tsxLoaderPath = require.resolve("tsx");

describe("entrypoint home directory propagation", () => {
  let root: string;
  let prodHome: string;
  let devHome: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "estacoda-entrypoint-home-"));
    prodHome = join(root, "prod-home");
    devHome = join(root, "dev-home");
    workspaceRoot = join(root, "workspace");
    await mkdir(prodHome, { recursive: true });
    await mkdir(devHome, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    workspaceRoot = await realpath(workspaceRoot);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes ESTACODA_HOME-resolved state home into pre-runtime CLI commands", async () => {
    await ensureProfileSkeleton({ homeDir: devHome, profileId: "default", blank: true });

    const result = await runEntrypoint({
      argv: ["profile", "show", "default"],
      cwd: workspaceRoot,
      homeDir: prodHome,
      estacodaHome: devHome
    });
    const devPaths = resolveProfileStateHome({ homeDir: devHome, profileId: "default" });
    const prodPaths = resolveProfileStateHome({ homeDir: prodHome, profileId: "default" });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Path: ${devPaths.profileRoot}`);
    expect(result.stdout).toContain(`Config: ${devPaths.configPath}`);
    expect(result.stdout).not.toContain(prodPaths.profileRoot);
  });

  it("uses the ESTACODA_HOME-resolved state home for entrypoint CLI session state", async () => {
    await ensureProfileSkeleton({ homeDir: devHome, profileId: "default", blank: true });

    const result = await runEntrypoint({
      argv: ["/status"],
      cwd: workspaceRoot,
      homeDir: prodHome,
      estacodaHome: devHome
    });
    const devCliSessionsPath = join(devHome, ".estacoda", "cli-sessions.json");
    const prodCliSessionsPath = join(prodHome, ".estacoda", "cli-sessions.json");
    const sessionState = JSON.parse(await readFile(devCliSessionsPath, "utf8")) as {
      entries?: Array<{ workspaceRoot?: string }>;
    };

    expect(result.code).toBe(0);
    expect(await pathExists(devCliSessionsPath)).toBe(true);
    expect(await pathExists(prodCliSessionsPath)).toBe(false);
    expect(sessionState.entries).toEqual([
      expect.objectContaining({ workspaceRoot })
    ]);
  });
});

type EntrypointResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

function runEntrypoint(input: {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly homeDir: string;
  readonly estacodaHome: string;
}): Promise<EntrypointResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      tsxLoaderPath,
      join(process.cwd(), "src", "index.ts"),
      ...input.argv
    ], {
      cwd: input.cwd,
      env: {
        ...process.env,
        HOME: input.homeDir,
        ESTACODA_HOME: input.estacodaHome,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for entrypoint home propagation command."));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
