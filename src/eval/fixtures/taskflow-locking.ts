import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeWorkflowStore } from "../../workflow/fake-workflow-store.js";
import { WorkflowLockService } from "../../workflow/workflow-lock-service.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";

export const taskflowLockingCase: EvalCase = {
  id: "taskflow-locking",
  name: "Flow lock acquire, release, heartbeat, and stale recovery",
  description: "Deterministic lock lifecycle with lease expiration and recovery.",
  tags: ["taskflow", "locking", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const now = new Date("2024-01-01T00:00:00.000Z");
    const store = new FakeWorkflowStore({ now: () => now });
    const lockService = new WorkflowLockService({
      store,
      now: () => now,
      defaultLeaseMs: 1000,
      heartbeatIntervalMs: 500
    });

    const assertions = [];

    // Acquire fresh lock
    const acquired = await lockService.acquire("flow-1", "owner-a");
    assertions.push(assertTrue("acquire fresh lock succeeds", acquired));

    // Second acquire by same owner should fail (lock held)
    const acquiredAgain = await lockService.acquire("flow-1", "owner-a");
    assertions.push(assertTrue("second acquire by same owner fails", !acquiredAgain));

    // Acquire by different owner should fail
    const acquiredOther = await lockService.acquire("flow-1", "owner-b");
    assertions.push(assertTrue("acquire by different owner fails", !acquiredOther));

    // Release and re-acquire
    await lockService.release("flow-1", "owner-a");
    const reacquired = await lockService.acquire("flow-1", "owner-b");
    assertions.push(assertTrue("re-acquire after release succeeds", reacquired));

    // Heartbeat extends lease
    const beforeHb = await lockService.get("flow-1");
    now.setTime(now.getTime() + 400);
    await lockService.heartbeat("flow-1", "owner-b");
    const afterHb = await lockService.get("flow-1");
    assertions.push(assertTrue("heartbeat updates heartbeat_at", (afterHb?.heartbeatAt ?? "") > (beforeHb?.heartbeatAt ?? "")));
    assertions.push(assertTrue("heartbeat extends expires_at", (afterHb?.expiresAt ?? "") > (beforeHb?.expiresAt ?? "")));

    // Stale lock recovery
    now.setTime(now.getTime() + 2000);
    const recovered = await lockService.recoverStale();
    assertions.push(assertEqual("stale lock recovered", recovered, 1));
    const afterRecovery = await lockService.get("flow-1");
    assertions.push(assertTrue("lock removed after stale recovery", afterRecovery === null));

    // Acquire after recovery
    const postRecovery = await lockService.acquire("flow-1", "owner-c");
    assertions.push(assertTrue("acquire after stale recovery succeeds", postRecovery));

    // Release by wrong owner does nothing
    await lockService.release("flow-1", "owner-x");
    const stillThere = await lockService.get("flow-1");
    assertions.push(assertTrue("release by wrong owner preserves lock", stillThere !== null));

    return buildResult("taskflow-locking", "Flow lock acquire, release, heartbeat, and stale recovery", assertions, Date.now() - startedAt);
  }
};
