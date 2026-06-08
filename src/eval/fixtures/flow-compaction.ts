import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { FakeWorkflowStore } from "../../workflow/fake-workflow-store.js";
import { WorkflowLockService } from "../../workflow/workflow-lock-service.js";
import { WorkflowEngine } from "../../workflow/workflow-engine.js";
import { WorkflowProcessRegistry } from "../../workflow/workflow-process-registry.js";
import { WorkflowCommandDispatcher } from "../../workflow/workflow-command-dispatcher.js";
import {
  WorkflowEventSummaryService,
  DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG,
} from "../../workflow/workflow-event-summary-service.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";
import type { IntentRoute } from "../../contracts/intent.js";

function makeIntent(): IntentRoute {
  return {
    nativeIntent: "general",
    labels: ["test"],
    confidence: 1,
    suggestedToolsets: [],
    suggestedSkills: [],
    confirmationRequired: false,
    evidence: [],
    rationale: "test intent",
  };
}

function makeNow(): () => Date {
  let t = 0;
  return () => {
    t += 1000;
    return new Date(t);
  };
}

export const flowCompactionCase: EvalCase = {
  id: "flow-compaction",
  name: "WorkflowRun-Safe Compaction: manual, automatic, boundary safety, preservation",
  description:
    "Manual /compact rejected during active execution. Succeeds when paused, waiting, interrupted, or between steps. Auto-compact disabled by default. Records durable events. Preserves all durable flow truth.",
  tags: ["taskflow", "compaction", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    const store = new FakeWorkflowStore({ now: makeNow() });
    const lockService = new WorkflowLockService({
      store,
      now: makeNow(),
      defaultLeaseMs: 30_000,
    });
    const engine = new WorkflowEngine({
      store,
      lockService,
      ownerId: "worker-1",
      now: makeNow(),
    });
    const processRegistry = new WorkflowProcessRegistry({ store });
    const compactionService = new WorkflowEventSummaryService({
      store,
      config: { ...DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG, enabled: false },
      now: makeNow(),
    });
    const dispatcher = new WorkflowCommandDispatcher({
      engine,
      store,
      processRegistry,
      compactionService,
    });

    // ─── Helper to build a flow with some completed steps ───
    async function buildTestFlow() {
      const flow = await engine.createWorkflowRun({
        sessionId: "session-1",
        intent: makeIntent(),
        plan: {
          name: "Compaction Test Plan",
          description: "A test plan",
          steps: [
            { name: "Step A", description: "First step", skippable: true, idempotent: true },
            { name: "Step B", description: "Second step" },
            { name: "Step C", description: "Third step" },
          ],
        },
      });
      await engine.startWorkflowRun(flow.id);
      return flow;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 1. Manual /compact rejected during active execution (running step)
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const r = await dispatcher.dispatch({
        command: "/compact",
        flowId: flow.id,
        operator: "op-1",
      });
      assertions.push(assertTrue("compact-rejected-running", !r.ok));
      if (!r.ok) {
        assertions.push(assertTrue("compact-rejected-running-msg", r.error.includes("Active step")));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. Manual /compact succeeds when paused
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.requestWorkflowPause(flow.id, "test pause");
      await engine.applyWorkflowPauseAtBoundary(flow.id);

      const r = await dispatcher.dispatch({
        command: "/compact",
        flowId: flow.id,
        operator: "op-1",
      });
      assertions.push(assertTrue("compact-paused-ok", r.ok));
      if (r.ok) {
        const summaries = await store.listWorkflowEventSummaries(flow.id);
        assertions.push(assertEqual("compact-paused-summary-exists", summaries.length, 1));
        const flowEvents = await store.listWorkflowEvents(flow.id, { kind: "compacted" });
        assertions.push(assertEqual("compact-paused-event-exists", flowEvents.length, 1));
        const opEvents = await store.listWorkflowOperatorEvents(flow.id, { kind: "operator-compacted" });
        assertions.push(assertEqual("compact-paused-op-event-exists", opEvents.length, 1));
        const updatedFlow = await store.getWorkflowRun(flow.id);
        assertions.push(assertTrue("compact-paused-compactedAt-set", !!updatedFlow?.compactedAt));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. Manual /compact succeeds when waiting
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const stepA = (await store.listWorkflowSteps(flow.id)).find((s) => s.name === "Step A")!;
      await engine.waitForInput(stepA.id, {
        kind: "user_input",
        description: "waiting for input",
      });
      const r = await dispatcher.dispatch({
        command: "/compact",
        flowId: flow.id,
        operator: "op-2",
      });
      assertions.push(assertTrue("compact-waiting-ok", r.ok));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. Manual /compact succeeds when interrupted
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.interruptWorkflowRun(flow.id, "test interrupt");
      const r = await dispatcher.dispatch({
        command: "/compact",
        flowId: flow.id,
        operator: "op-3",
      });
      assertions.push(assertTrue("compact-interrupted-ok", r.ok));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. Manual /compact succeeds between steps (all steps completed)
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const steps = await store.listWorkflowSteps(flow.id);
      for (const step of steps) {
        await engine.completeWorkflowStep(step.id);
      }
      const r = await dispatcher.dispatch({
        command: "/compact",
        flowId: flow.id,
        operator: "op-4",
      });
      assertions.push(assertTrue("compact-between-steps-ok", r.ok));
      if (r.ok) {
        const summaries = await store.listWorkflowEventSummaries(flow.id);
        assertions.push(assertTrue("compact-between-steps-has-summaries", summaries.length > 0));
        // Verify turn summaries were generated from completed steps
        const latest = summaries[0];
        assertions.push(assertTrue("compact-between-steps-turn-summaries", latest.turnSummaries.length >= 3));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 6. Manual /compact rejected during active process execution
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const stepA = (await store.listWorkflowSteps(flow.id)).find((s) => s.name === "Step A")!;
      // Register a running process
      await store.registerWorkflowProcess({
        id: "proc-1",
        flowId: flow.id,
        stepId: stepA.id,
        processManagerId: "mgr-1",
        processType: "terminal",
        commandSummary: "sleep 10",
        startedAt: new Date().toISOString(),
        status: "running",
      });
      const r = await dispatcher.dispatch({
        command: "/compact",
        flowId: flow.id,
        operator: "op-5",
      });
      assertions.push(assertTrue("compact-rejected-process", !r.ok));
      if (!r.ok) {
        assertions.push(assertTrue("compact-rejected-process-msg", r.error.includes("process")));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 7. Automatic compaction disabled by default
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const steps = await store.listWorkflowSteps(flow.id);
      for (const step of steps) {
        await engine.completeWorkflowStep(step.id);
      }
      // Default config has enabled=false
      const autoResult = await compactionService.checkAndAutoCompact(flow.id);
      assertions.push(assertEqual("auto-disabled", autoResult, null));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 8. Automatic compaction triggers when enabled and threshold exceeded
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const steps = await store.listWorkflowSteps(flow.id);
      for (const step of steps) {
        await engine.completeWorkflowStep(step.id);
      }

      // Seed many flow events to exceed threshold
      for (let i = 0; i < 55; i++) {
        await store.appendWorkflowEvent({
          id: `ev-${i}`,
          flowId: flow.id,
          kind: "step-started",
          data: { index: i },
          timestamp: new Date(i * 1000).toISOString(),
        });
      }

      const enabledService = new WorkflowEventSummaryService({
        store,
        config: { ...DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG, enabled: true, eventThreshold: 50, minTurnsBeforeCompact: 1 },
        now: makeNow(),
      });
      const autoResult = await enabledService.checkAndAutoCompact(flow.id);
      assertions.push(assertTrue("auto-triggered", !!autoResult));
      if (autoResult) {
        assertions.push(assertEqual("auto-mode", autoResult.mode, "automatic"));
        assertions.push(assertTrue("auto-summary", !!autoResult.summary));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 9. Automatic compaction does not trigger below threshold
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const steps = await store.listWorkflowSteps(flow.id);
      for (const step of steps) {
        await engine.completeWorkflowStep(step.id);
      }

      // Only 5 events — below threshold
      for (let i = 0; i < 5; i++) {
        await store.appendWorkflowEvent({
          id: `low-ev-${i}`,
          flowId: flow.id,
          kind: "step-started",
          data: { index: i },
          timestamp: new Date(i * 1000).toISOString(),
        });
      }

      const enabledService = new WorkflowEventSummaryService({
        store,
        config: { ...DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG, enabled: true, eventThreshold: 50, minTurnsBeforeCompact: 1 },
        now: makeNow(),
      });
      const autoResult = await enabledService.checkAndAutoCompact(flow.id);
      assertions.push(assertEqual("auto-below-threshold", autoResult, null));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 10. Automatic compaction only runs at safe boundaries
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      // WorkflowRun is running; auto-compact should not trigger even with threshold exceeded
      for (let i = 0; i < 55; i++) {
        await store.appendWorkflowEvent({
          id: `unsafe-ev-${i}`,
          flowId: flow.id,
          kind: "step-started",
          data: { index: i },
          timestamp: new Date(i * 1000).toISOString(),
        });
      }
      const enabledService = new WorkflowEventSummaryService({
        store,
        config: { ...DEFAULT_WORKFLOW_EVENT_SUMMARY_CONFIG, enabled: true, eventThreshold: 10, minTurnsBeforeCompact: 0 },
        now: makeNow(),
      });
      const autoResult = await enabledService.checkAndAutoCompact(flow.id);
      assertions.push(assertEqual("auto-unsafe-boundary", autoResult, null));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 11. Compaction preserves flow state
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.requestWorkflowPause(flow.id, "test");
      await engine.applyWorkflowPauseAtBoundary(flow.id);
      const before = await store.getWorkflowRun(flow.id);
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-6" });
      const after = await store.getWorkflowRun(flow.id);
      assertions.push(assertEqual("preserve-flow-status", after?.status, before?.status));
      assertions.push(assertEqual("preserve-flow-id", after?.id, before?.id));
      assertions.push(assertEqual("preserve-session-id", after?.sessionId, before?.sessionId));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 12. Compaction preserves step state
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.requestWorkflowPause(flow.id, "test");
      await engine.applyWorkflowPauseAtBoundary(flow.id);
      const beforeSteps = await store.listWorkflowSteps(flow.id);
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-7" });
      const afterSteps = await store.listWorkflowSteps(flow.id);
      assertions.push(assertEqual("preserve-step-count", afterSteps.length, beforeSteps.length));
      for (let i = 0; i < beforeSteps.length; i++) {
        assertions.push(assertEqual(`preserve-step-status-${i}`, afterSteps[i].status, beforeSteps[i].status));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 13. Compaction preserves approval gates
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const stepC = (await store.listWorkflowSteps(flow.id)).find((s) => s.name === "Step C")!;
      await store.createWorkflowApprovalGate({
        id: "gate-1",
        stepId: stepC.id,
        flowId: flow.id,
        status: "approved",
        requestedAt: new Date().toISOString(),
        reason: "test",
        riskClass: "read-only-local",
        toolExecutorDecision: "allow",
      });
      await engine.requestWorkflowPause(flow.id, "test");
      await engine.applyWorkflowPauseAtBoundary(flow.id);
      const beforeGates = await store.listWorkflowApprovalGates(flow.id);
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-8" });
      const afterGates = await store.listWorkflowApprovalGates(flow.id);
      assertions.push(assertEqual("preserve-approval-count", afterGates.length, beforeGates.length));
      assertions.push(assertEqual("preserve-approval-status", afterGates[0].status, beforeGates[0].status));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 14. Compaction preserves operator events
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await store.appendWorkflowOperatorEvent({
        id: "op-ev-1",
        flowId: flow.id,
        kind: "operator-paused",
        operator: "op-1",
        command: "/pause",
        effect: "paused",
        previousState: "running",
        newState: "paused",
        timestamp: new Date().toISOString(),
      });
      await engine.requestWorkflowPause(flow.id, "test");
      await engine.applyWorkflowPauseAtBoundary(flow.id);
      const beforeOpEvents = await store.listWorkflowOperatorEvents(flow.id);
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-9" });
      const afterOpEvents = await store.listWorkflowOperatorEvents(flow.id);
      // Operator events should be preserved (new compaction event added)
      assertions.push(assertTrue("preserve-operator-events", afterOpEvents.length >= beforeOpEvents.length));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 15. Compaction preserves retry/failure/interruption/cancellation state
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      const stepA = (await store.listWorkflowSteps(flow.id)).find((s) => s.name === "Step A")!;
      await engine.failWorkflowStep(stepA.id, "simulated failure");
      const beforeSteps = await store.listWorkflowSteps(flow.id);
      const failedStep = beforeSteps.find((s) => s.id === stepA.id)!;
      assertions.push(assertEqual("pre-compact-failed", failedStep.status, "failed"));
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-10" });
      const afterSteps = await store.listWorkflowSteps(flow.id);
      const afterFailedStep = afterSteps.find((s) => s.id === stepA.id)!;
      assertions.push(assertEqual("preserve-failure-state", afterFailedStep.status, "failed"));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 16. Compaction records durable event/artifact
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.interruptWorkflowRun(flow.id, "test");
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-11" });
      const flowEvents = await store.listWorkflowEvents(flow.id, { kind: "compacted" });
      assertions.push(assertEqual("durable-compact-event", flowEvents.length, 1));
      const opEvents = await store.listWorkflowOperatorEvents(flow.id, { kind: "operator-compacted" });
      assertions.push(assertEqual("durable-op-compact-event", opEvents.length, 1));
      const summaries = await store.listWorkflowEventSummaries(flow.id);
      assertions.push(assertEqual("durable-summary-record", summaries.length, 1));
    }

    // ═══════════════════════════════════════════════════════════════════
    // 17. /trace shows compaction event
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.interruptWorkflowRun(flow.id, "test");
      await dispatcher.dispatch({ command: "/compact", flowId: flow.id, operator: "op-12" });
      const traceResult = await dispatcher.dispatch({ command: "/trace", flowId: flow.id });
      assertions.push(assertTrue("trace-ok", traceResult.ok));
      if (traceResult.ok) {
        const message = traceResult.message;
        assertions.push(assertTrue("trace-shows-compacted", message.includes("compacted")));
        assertions.push(assertTrue("trace-shows-summary-ref", message.includes("summary:")));
        const data = traceResult.data as any;
        assertions.push(assertTrue("trace-has-compact-summaries", data.compactSummaries.length > 0));
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 18. Compaction failure records failure event without corrupting flow state
    // ═══════════════════════════════════════════════════════════════════
    {
      const flow = await buildTestFlow();
      await engine.interruptWorkflowRun(flow.id, "test");
      const before = await store.getWorkflowRun(flow.id);
      // Compaction on a non-existent flow should fail cleanly
      const badResult = await compactionService.compact("no-such-flow", "op-13");
      assertions.push(assertTrue("failure-ok-false", !badResult.ok));
      assertions.push(assertTrue("failure-has-error", !!badResult.error));
      // Existing flow state untouched
      const after = await store.getWorkflowRun(flow.id);
      assertions.push(assertEqual("failure-no-corrupt-status", after?.status, before?.status));
    }

    return buildResult("flow-compaction", "WorkflowRun-Safe Compaction: manual, automatic, boundary safety, preservation", assertions, startedAt);
  },
};
