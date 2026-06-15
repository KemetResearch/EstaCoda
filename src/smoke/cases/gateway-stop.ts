import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { SmokeCase } from "../smoke-case.js";
import { runGatewayStop } from "../../cli/gateway-commands.js";
import { writeGatewayPid } from "../../gateway/pid-file.js";
import { writeGatewayState } from "../../gateway/supervisor-state.js";
import { resolveProfileStateHome } from "../../config/profile-home.js";

function spawnDecoy(script: string, interpreter?: string[]): ReturnType<typeof spawn> {
  const args = interpreter ?? [process.execPath, "-e"];
  return spawn(args[0], [...args.slice(1), script], {
    detached: false,
    stdio: "ignore",
  });
}

async function spawnReadyDecoy(script: string): Promise<ReturnType<typeof spawn>> {
  const child = spawn(process.execPath, ["-e", script], {
    detached: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  child.stdout.setEncoding("utf8");
  const [chunk] = await once(child.stdout, "data") as [string];
  if (!chunk.includes("ready")) {
    throw new Error(`Decoy did not report ready: ${chunk}`);
  }
  return child;
}

function waitForPid(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    if (child.pid !== undefined) {
      resolve(child.pid);
      return;
    }
    child.on("spawn", () => {
      if (child.pid !== undefined) resolve(child.pid);
      else reject(new Error("No PID"));
    });
    child.on("error", reject);
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const gateway_stop_case: SmokeCase = {
  id: "gateway-stop",
  name: "gateway stop sends SIGTERM and cleans up PID/state files",
  tags: ["lifecycle", "gateway", "stop"],
  run: async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "estacoda-smoke-stop-"));
    const profileId = "smoke-gateway-stop";
    const profilePaths = resolveProfileStateHome({ homeDir: tempHome, profileId });

    const pidPath = join(profilePaths.gatewayStatePath, "gateway.pid");
    const statePath = join(profilePaths.gatewayStatePath, "gateway-state.json");

    try {
      // Test 1: Graceful stop (process exits on SIGTERM)
      const child1 = spawnDecoy("process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);");
      const pid1 = await waitForPid(child1);

      await writeGatewayPid(profilePaths, { pid: pid1, startedAt: new Date().toISOString(), version: "0.0.1", profileId });
      await writeGatewayState(profilePaths, { lifecycle: "running", startedAt: new Date().toISOString(), pid: pid1, version: "0.0.1", profileId });

      const result1 = await runGatewayStop({ workspaceRoot: tempHome, homeDir: tempHome, profileId });
      if (!result1.ok) {
        throw new Error(`gateway stop failed: ${result1.output}`);
      }
      if (!result1.output.includes("Gateway service stopped") && !result1.output.includes("Gateway stopped")) {
        throw new Error(`Unexpected output: ${result1.output}`);
      }
      if (isAlive(pid1)) {
        throw new Error("Decoy process 1 should be dead after SIGTERM");
      }
      if (existsSync(pidPath)) {
        throw new Error("gateway.pid should be removed after stop");
      }
      if (existsSync(statePath)) {
        throw new Error("gateway-state.json should be removed after stop");
      }

      // Test 2: Force stop (process ignores SIGTERM)
      const child2 = await spawnReadyDecoy(
        "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);"
      );
      const pid2 = await waitForPid(child2);

      await writeGatewayPid(profilePaths, { pid: pid2, startedAt: new Date().toISOString(), version: "0.0.1", profileId });
      await writeGatewayState(profilePaths, { lifecycle: "running", startedAt: new Date().toISOString(), pid: pid2, version: "0.0.1", profileId });

      const result2 = await runGatewayStop({ workspaceRoot: tempHome, homeDir: tempHome, profileId, force: true });
      if (!result2.ok) {
        throw new Error(`gateway stop --force failed: ${result2.output}`);
      }
      if (!result2.output.includes("forced")) {
        throw new Error(`Expected 'forced' in output, got: ${result2.output}`);
      }
      if (isAlive(pid2)) {
        throw new Error("Decoy process 2 should be dead after SIGKILL");
      }
      if (existsSync(pidPath)) {
        throw new Error("gateway.pid should be removed after forced stop");
      }
      if (existsSync(statePath)) {
        throw new Error("gateway-state.json should be removed after forced stop");
      }
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  }
};
