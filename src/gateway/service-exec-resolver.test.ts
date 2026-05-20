import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { resolveGatewayExec } from "./service-exec-resolver.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "estacoda-exec-resolver-test-"));
}

describe("resolveGatewayExec", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("prefers package bin and does not include gateway start", async () => {
    tmpDir = await makeTempDir();
    await writeFile(join(tmpDir, "package.json"), JSON.stringify({ bin: { estacoda: "./bin/estacoda.js" } }), "utf8");
    await mkdir(join(tmpDir, "bin"), { recursive: true });
    await writeFile(join(tmpDir, "bin", "estacoda.js"), "#!/usr/bin/env node\n", "utf8");

    const result = resolveGatewayExec({ workspaceRoot: tmpDir, execPath: "/usr/local/bin/node" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.mode).toBe("package-bin");
    expect(result.resolved.command).toBe("/usr/local/bin/node");
    expect(result.resolved.args).toEqual([join(tmpDir, "bin", "estacoda.js")]);
    expect(result.resolved.args).not.toContain("gateway");
    expect(result.resolved.args).not.toContain("start");
    expect(result.resolved.args).not.toContain("--profile");
  });

  it("uses compiled dist when no package bin exists", async () => {
    tmpDir = await makeTempDir();
    await mkdir(join(tmpDir, "dist"), { recursive: true });
    await writeFile(join(tmpDir, "dist", "index.js"), "console.log('ok');\n", "utf8");

    const result = resolveGatewayExec({ workspaceRoot: tmpDir, execPath: "/usr/bin/node" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.mode).toBe("compiled");
    expect(result.resolved.command).toBe("/usr/bin/node");
    expect(result.resolved.args).toEqual([join(tmpDir, "dist", "index.js")]);
  });

  it("uses source Bun fallback from argv-based lookup", async () => {
    tmpDir = await makeTempDir();
    const result = resolveGatewayExec({
      workspaceRoot: tmpDir,
      commandLookup: (command) => command === "bun" ? "/usr/local/bin/bun" : undefined,
      execPath: "/usr/bin/node",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.mode).toBe("source");
    expect(result.resolved.command).toBe("/usr/local/bin/bun");
    expect(result.resolved.args).toEqual(["run", join(tmpDir, "src", "index.ts")]);
    expect(result.resolved.args).not.toContain("gateway");
    expect(result.resolved.args).not.toContain("start");
  });

  it("falls back to process execPath when it is Bun", async () => {
    tmpDir = await makeTempDir();
    const result = resolveGatewayExec({
      workspaceRoot: tmpDir,
      commandLookup: () => undefined,
      execPath: "/opt/homebrew/bin/bun",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.mode).toBe("source");
    expect(result.resolved.command).toBe("/opt/homebrew/bin/bun");
  });

  it("fails when neither package, compiled, nor Bun source mode is available", async () => {
    tmpDir = await makeTempDir();
    const result = resolveGatewayExec({
      workspaceRoot: tmpDir,
      commandLookup: () => undefined,
      execPath: "/usr/bin/node",
    });

    expect(result).toEqual({
      ok: false,
      error: "bun not found in PATH. Install bun or use compiled/package mode.",
    });
  });

  it("returns only absolute paths", async () => {
    tmpDir = await makeTempDir();
    const result = resolveGatewayExec({
      workspaceRoot: tmpDir,
      commandLookup: () => "/usr/local/bin/bun",
      execPath: "/usr/bin/node",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isAbsolute(result.resolved.command)).toBe(true);
    expect(isAbsolute(result.resolved.cwd)).toBe(true);
    for (const arg of result.resolved.args.filter((value) => value.includes("/"))) {
      expect(isAbsolute(arg)).toBe(true);
    }
  });
});
