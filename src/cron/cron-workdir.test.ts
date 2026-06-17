import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCronWorkdir } from "./cron-workdir.js";

describe("resolveCronWorkdir", () => {
  let tmpDir: string;
  let workspace: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "estacoda-cron-workdir-test-"));
    workspace = join(tmpDir, "workspace");
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts an absolute existing workdir inside a trusted workspace", async () => {
    const workdir = join(workspace, "reports");
    await mkdir(workdir);
    const workdirReal = await realpath(workdir);

    const result = await resolveCronWorkdir({
      requestedWorkdir: workdir,
      defaultWorkspaceRoot: workspace,
      allowedRoots: [workspace],
      isWorkspaceTrusted: async (path) => path === workdirReal
    });

    expect(result).toMatchObject({
      ok: true,
      workdir: workdirReal,
      trustedWorkspace: true
    });
  });

  it("rejects a relative workdir", async () => {
    const result = await resolveCronWorkdir({
      requestedWorkdir: "reports",
      defaultWorkspaceRoot: workspace,
      allowedRoots: [workspace],
      isWorkspaceTrusted: async () => true
    });

    expect(result).toEqual({ ok: false, message: "Cron workdir must be an absolute path." });
  });

  it("rejects a missing workdir", async () => {
    const result = await resolveCronWorkdir({
      requestedWorkdir: join(workspace, "missing"),
      defaultWorkspaceRoot: workspace,
      allowedRoots: [workspace],
      isWorkspaceTrusted: async () => true
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Cannot resolve cron workdir");
    }
  });

  it("rejects symlink escapes from the allowed root", async () => {
    const outside = join(tmpDir, "outside");
    await mkdir(outside);
    const link = join(workspace, "outside-link");
    await symlink(outside, link);

    const result = await resolveCronWorkdir({
      requestedWorkdir: link,
      defaultWorkspaceRoot: workspace,
      allowedRoots: [workspace],
      isWorkspaceTrusted: async () => true
    });

    expect(result).toEqual({ ok: false, message: "Cron workdir must stay inside an allowed workspace root." });
  });

  it("rejects arbitrary absolute directories outside allowed roots", async () => {
    const outside = join(tmpDir, "outside");
    await mkdir(outside);

    const result = await resolveCronWorkdir({
      requestedWorkdir: outside,
      defaultWorkspaceRoot: workspace,
      allowedRoots: [workspace],
      isWorkspaceTrusted: async () => true
    });

    expect(result).toEqual({ ok: false, message: "Cron workdir must stay inside an allowed workspace root." });
  });

  it("does not mark an untrusted workdir trusted just because it exists", async () => {
    const workdir = join(workspace, "reports");
    await mkdir(workdir);
    const workdirReal = await realpath(workdir);

    const result = await resolveCronWorkdir({
      requestedWorkdir: workdir,
      defaultWorkspaceRoot: workspace,
      allowedRoots: [workspace],
      isWorkspaceTrusted: async () => false
    });

    expect(result).toMatchObject({
      ok: true,
      workdir: workdirReal,
      trustedWorkspace: false
    });
  });
});
