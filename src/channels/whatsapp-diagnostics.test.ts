import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getWhatsAppGatewayDiagnostics } from "./whatsapp-diagnostics.js";

describe("getWhatsAppGatewayDiagnostics", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "estacoda-whatsapp-diagnostics-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses ESTACODA_HOME before HOME for default auth state paths", async () => {
    const prodHome = join(tempDir, "prod-home");
    const devHome = join(tempDir, "dev-home");
    await mkdir(prodHome, { recursive: true });
    await mkdir(join(devHome, ".estacoda", "whatsapp-auth"), { recursive: true });

    const previousHome = process.env.HOME;
    const previousEstacodaHome = process.env.ESTACODA_HOME;
    process.env.HOME = prodHome;
    process.env.ESTACODA_HOME = devHome;
    try {
      const diagnostics = await getWhatsAppGatewayDiagnostics();

      expect(diagnostics.authDir).toBe(join(devHome, ".estacoda", "whatsapp-auth"));
      expect(diagnostics.authDir).not.toContain(prodHome);
      expect(diagnostics.authDirWritable).toBe(true);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousEstacodaHome === undefined) {
        delete process.env.ESTACODA_HOME;
      } else {
        process.env.ESTACODA_HOME = previousEstacodaHome;
      }
    }
  });

  it("reports bridge package readiness without importing root Baileys", async () => {
    const homeDir = join(tempDir, "home");
    const bridgeDir = join(tempDir, "bridge");
    await mkdir(join(homeDir, ".estacoda", "whatsapp-auth"), { recursive: true });
    await mkdir(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys"), { recursive: true });
    await mkdir(join(bridgeDir, "node_modules", "@hapi", "boom"), { recursive: true });
    await writeFile(join(bridgeDir, "package.json"), JSON.stringify({
      dependencies: {
        "@whiskeysockets/baileys": "^7.0.0-rc.9",
        "@hapi/boom": "^9.1.4"
      }
    }), "utf8");
    await writeFile(join(bridgeDir, "package-lock.json"), "{}\n", "utf8");
    await writeFile(join(bridgeDir, "bridge.js"), "export {};\n", "utf8");
    await writeFile(join(bridgeDir, "README.md"), "# bridge\n", "utf8");
    await writeFile(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys", "package.json"), "{}\n", "utf8");
    await writeFile(join(bridgeDir, "node_modules", "@hapi", "boom", "package.json"), "{}\n", "utf8");

    const diagnostics = await getWhatsAppGatewayDiagnostics({ homeDir, bridgeDir });

    expect(diagnostics.bridgePackagePresent).toBe(true);
    expect(diagnostics.bridgeLockfilePresent).toBe(true);
    expect(diagnostics.bridgeEntrypointPresent).toBe(true);
    expect(diagnostics.bridgeReadmePresent).toBe(true);
    expect(diagnostics.bridgeDependenciesInstalled).toBe(true);
    expect(diagnostics.missing).toEqual([]);
  });

  it("finds the default bridge package when commands run outside the package root", async () => {
    const homeDir = join(tempDir, "home");
    const workspaceDir = join(tempDir, "workspace");
    await mkdir(join(homeDir, ".estacoda", "whatsapp-auth"), { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    const previousCwd = process.cwd();
    process.chdir(workspaceDir);
    try {
      const diagnostics = await getWhatsAppGatewayDiagnostics({ homeDir });

      expect(diagnostics.bridgeDir).not.toBe(join(workspaceDir, "scripts", "whatsapp-bridge"));
      expect(diagnostics.bridgePackagePresent).toBe(true);
      expect(diagnostics.bridgeLockfilePresent).toBe(true);
      expect(diagnostics.bridgeEntrypointPresent).toBe(true);
      expect(diagnostics.bridgeReadmePresent).toBe(true);
      expect(diagnostics.ready).toBe(false);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("reports missing bridge dependencies clearly", async () => {
    const homeDir = join(tempDir, "home");
    const bridgeDir = join(tempDir, "bridge");
    await mkdir(join(homeDir, ".estacoda", "whatsapp-auth"), { recursive: true });
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(join(bridgeDir, "package.json"), JSON.stringify({
      dependencies: {
        "@whiskeysockets/baileys": "^7.0.0-rc.9"
      }
    }), "utf8");
    await writeFile(join(bridgeDir, "package-lock.json"), "{}\n", "utf8");
    await writeFile(join(bridgeDir, "bridge.js"), "export {};\n", "utf8");
    await writeFile(join(bridgeDir, "README.md"), "# bridge\n", "utf8");

    const diagnostics = await getWhatsAppGatewayDiagnostics({ homeDir, bridgeDir });

    expect(diagnostics.bridgeDependenciesInstalled).toBe(false);
    expect(diagnostics.statusLabel).toBe("bridge dependencies missing");
    expect(diagnostics.missing).toContain("bridgeDependencies");
  });

  it("distinguishes pairing-pending WhatsApp from fully ready allowlisted WhatsApp", async () => {
    const homeDir = join(tempDir, "home");
    const bridgeDir = join(tempDir, "bridge");
    await mkdir(join(homeDir, ".estacoda", "whatsapp-auth"), { recursive: true });
    await writeReadyBridgePackage(bridgeDir);

    const pending = await getWhatsAppGatewayDiagnostics({
      homeDir,
      bridgeDir,
      config: {
        enabled: true,
        experimental: true,
        dmPolicy: "pairing",
        allowedUsers: [],
      },
    });

    expect(pending.ready).toBe(false);
    expect(pending.statusLabel).toBe("pairing pending");
    expect(pending.pairingPending).toBe(true);
    expect(pending.missing).toContain("pairingPending");

    const allowlisted = await getWhatsAppGatewayDiagnostics({
      homeDir,
      bridgeDir,
      config: {
        enabled: true,
        experimental: true,
        dmPolicy: "allowlist",
        allowedUsers: ["971501234567"],
      },
    });

    expect(allowlisted.ready).toBe(true);
    expect(allowlisted.statusLabel).toBe("ok");
    expect(allowlisted.pairingPending).toBe(false);
    expect(allowlisted.missing).toEqual([]);
  });

  it("does not report an outside-root WhatsApp authDir as ready", async () => {
    const homeDir = join(tempDir, "home");
    const bridgeDir = join(tempDir, "bridge");
    await mkdir(join(homeDir, ".estacoda", "whatsapp-auth"), { recursive: true });
    await mkdir(join(tempDir, "outside-whatsapp-auth"), { recursive: true });
    await writeReadyBridgePackage(bridgeDir);

    const diagnostics = await getWhatsAppGatewayDiagnostics({
      homeDir,
      bridgeDir,
      config: {
        enabled: true,
        experimental: true,
        authDir: join(tempDir, "outside-whatsapp-auth"),
        dmPolicy: "allowlist",
        allowedUsers: ["971501234567"],
      },
    });

    expect(diagnostics.ready).toBe(false);
    expect(diagnostics.statusLabel).toBe("auth directory outside profile WhatsApp state");
    expect(diagnostics.missing).toContain("authDirProfileLocal");
  });
});

async function writeReadyBridgePackage(bridgeDir: string): Promise<void> {
  await mkdir(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys"), { recursive: true });
  await mkdir(join(bridgeDir, "node_modules", "@hapi", "boom"), { recursive: true });
  await writeFile(join(bridgeDir, "package.json"), JSON.stringify({
    dependencies: {
      "@whiskeysockets/baileys": "^7.0.0-rc.9",
      "@hapi/boom": "^9.1.4"
    }
  }), "utf8");
  await writeFile(join(bridgeDir, "package-lock.json"), "{}\n", "utf8");
  await writeFile(join(bridgeDir, "bridge.js"), "export {};\n", "utf8");
  await writeFile(join(bridgeDir, "README.md"), "# bridge\n", "utf8");
  await writeFile(join(bridgeDir, "node_modules", "@whiskeysockets", "baileys", "package.json"), "{}\n", "utf8");
  await writeFile(join(bridgeDir, "node_modules", "@hapi", "boom", "package.json"), "{}\n", "utf8");
}
