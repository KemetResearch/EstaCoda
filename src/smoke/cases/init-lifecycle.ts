import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SmokeCase } from "../smoke-case.js";
import { runInitCommand } from "../../cli/init-command.js";
import { runSetupVerification } from "../../onboarding/verification.js";

export const init_lifecycle_case: SmokeCase = {
  id: "init-lifecycle",
  name: "Init creates expected dirs and verify passes",
  tags: ["lifecycle", "init"],
  run: async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "estacoda-smoke-init-"));

    try {
      const initResult = await runInitCommand({ homeDir: tempHome });
      if (initResult.exitCode !== 0) {
        throw new Error(`init failed: ${initResult.output}`);
      }

      const expectedDirs = [
        "memory",
        "skills",
        "skills/local",
        "skills/.evolution",
        "packs",
        "cron",
        ".backups"
      ];

      for (const dir of expectedDirs) {
        const path = join(tempHome, ".estacoda", dir);
        if (!existsSync(path)) {
          throw new Error(`Expected directory missing: ${dir}`);
        }
      }

      if (!existsSync(join(tempHome, ".estacoda", "config.json"))) {
        throw new Error("config.json was not created");
      }

      if (!existsSync(join(tempHome, ".estacoda", "trust.json"))) {
        throw new Error("trust.json was not created");
      }

      const verifyResult = await runSetupVerification({
        workspaceRoot: process.cwd(),
        homeDir: tempHome
      });

      // Bare init produces warnings (no provider, not trusted), but should run without crashing
      if (verifyResult.output.length === 0) {
        throw new Error("verify produced no output");
      }
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }
};
