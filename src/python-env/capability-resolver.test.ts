import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerPythonCapabilitySpecForTest,
  resetPythonCapabilityRegistryForTest
} from "./capability-registry.js";
import { resolveManagedPythonCapabilityPaths } from "./capability-paths.js";
import { resolveCapabilityPythonEnv } from "./capability-resolver.js";
import {
  readManagedPythonCapabilityManifest,
  writeManagedPythonCapabilityManifest,
  type ManagedPythonCapabilityEnvManifest
} from "./manifest.js";
import { fingerprintManagedPythonCapabilitySpec } from "./spec-hash.js";

describe("managed Python capability resolver", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "estacoda-python-capability-resolver-test-"));
    resetPythonCapabilityRegistryForTest();
  });

  afterEach(() => {
    resetPythonCapabilityRegistryForTest();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns pythonPath only for an installed and verified registered capability", async () => {
    const spec = registerFakeCapability();
    const paths = resolveManagedPythonCapabilityPaths({ stateRoot: tempDir, capabilityId: spec.id });
    await writeFakePython(paths.pythonPath);
    await writeManifest(manifestFor({
      id: spec.id,
      specHash: fingerprintManagedPythonCapabilitySpec(spec),
      envPath: paths.envPath,
      pythonPath: paths.pythonPath,
      status: "verified"
    }));

    const result = await resolveCapabilityPythonEnv(spec.id, { stateRoot: tempDir });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: spec.id,
      envPath: paths.envPath,
      pythonPath: paths.pythonPath
    });
  });

  it("returns install_required with a repair command for a missing env without installing", async () => {
    const spec = registerFakeCapability();

    const result = await resolveCapabilityPythonEnv(spec.id, { stateRoot: tempDir });

    expect(result).toMatchObject({
      ok: false,
      reason: "install_required",
      repairCommand: `estacoda python-env setup ${spec.id}`
    });
    expect(result.ok).toBe(false);
    expect("pythonPath" in result).toBe(false);
    expect("envPath" in result).toBe(false);
  });

  it("returns upgrade_required for spec hash mismatch without installing", async () => {
    const spec = registerFakeCapability();
    const paths = resolveManagedPythonCapabilityPaths({ stateRoot: tempDir, capabilityId: spec.id });
    await writeFakePython(paths.pythonPath);
    await writeManifest(manifestFor({
      id: spec.id,
      specHash: "old-hash",
      envPath: paths.envPath,
      pythonPath: paths.pythonPath,
      status: "verified"
    }));

    const result = await resolveCapabilityPythonEnv(spec.id, { stateRoot: tempDir });

    expect(result).toMatchObject({
      ok: false,
      reason: "upgrade_required",
      repairCommand: `estacoda python-env upgrade ${spec.id}`
    });
  });

  it("returns unavailable for installed but unverified envs without mutating the manifest", async () => {
    const spec = registerFakeCapability();
    const paths = resolveManagedPythonCapabilityPaths({ stateRoot: tempDir, capabilityId: spec.id });
    await writeFakePython(paths.pythonPath);
    const manifest = manifestFor({
      id: spec.id,
      specHash: fingerprintManagedPythonCapabilitySpec(spec),
      envPath: paths.envPath,
      pythonPath: paths.pythonPath,
      status: "installed"
    });
    await writeManifest(manifest);

    const result = await resolveCapabilityPythonEnv(spec.id, { stateRoot: tempDir });

    expect(result).toMatchObject({
      ok: false,
      reason: "unverified",
      repairCommand: `estacoda python-env verify ${spec.id}`
    });
    expect("pythonPath" in result).toBe(false);
    expect("envPath" in result).toBe(false);
    await expect(readManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: spec.id
    })).resolves.toEqual(manifest);
  });

  it("rejects unknown capability ids and optional groups", async () => {
    registerFakeCapability();

    await expect(resolveCapabilityPythonEnv("missing-capability", { stateRoot: tempDir })).resolves.toMatchObject({
      ok: false,
      reason: "not_configured"
    });
    await expect(resolveCapabilityPythonEnv("fake-resolver", {
      stateRoot: tempDir,
      groups: ["missing-group"]
    })).resolves.toMatchObject({
      ok: false,
      reason: "not_configured",
      message: expect.stringContaining("Unknown optional group")
    });
  });

  it("includes selected optional groups in repair commands", async () => {
    const spec = registerFakeCapability();

    const result = await resolveCapabilityPythonEnv(spec.id, {
      stateRoot: tempDir,
      groups: ["extra"]
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "install_required",
      repairCommand: `estacoda python-env setup ${spec.id} --group extra`
    });
  });

  async function writeManifest(manifest: ManagedPythonCapabilityEnvManifest): Promise<void> {
    await writeManagedPythonCapabilityManifest({
      stateRoot: tempDir,
      capabilityId: manifest.id
    }, manifest);
  }
});

function registerFakeCapability() {
  const spec = {
    id: "fake-resolver",
    version: "0.1.0",
    packages: ["demo-package==1.2.3"],
    verifyImports: ["json"],
    optionalGroups: {
      extra: {
        packages: ["demo-extra==2.0.0"],
        verifyImports: ["email"]
      }
    }
  };
  registerPythonCapabilitySpecForTest(spec);
  return spec;
}

async function writeFakePython(pythonPath: string): Promise<void> {
  await mkdir(dirname(pythonPath), { recursive: true });
  writeFileSync(pythonPath, "", "utf8");
}

function manifestFor(input: {
  id: string;
  specHash: string;
  envPath: string;
  pythonPath: string;
  status: ManagedPythonCapabilityEnvManifest["status"];
}): ManagedPythonCapabilityEnvManifest {
  return {
    id: input.id,
    version: "0.1.0",
    specHash: input.specHash,
    installedPackages: ["demo-package==1.2.3"],
    installedGroups: [],
    pythonPath: input.pythonPath,
    envPath: input.envPath,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    verifiedAt: input.status === "verified" ? "2026-06-13T00:00:00.000Z" : undefined,
    status: input.status
  };
}
