import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
});
