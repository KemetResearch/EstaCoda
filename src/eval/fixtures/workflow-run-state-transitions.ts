import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import {
  validateWorkflowRunTransition,
  validateWorkflowStepTransition,
  isRetryAllowed,
  IllegalTransitionError,
  defaultRetryPolicy,
  defaultFailurePolicy
} from "../../workflow/types.js";
import { assertEqual, assertTrue, buildResult } from "../eval-runner.js";

export const workflowRunStateTransitionsCase: EvalCase = {
  id: "workflow-run-state-transitions",
  name: "WorkflowRun and step state transitions are validated correctly",
  description: "Legal transitions succeed; illegal transitions throw IllegalTransitionError.",
  tags: ["workflow", "state-machine", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const assertions = [];

    // Legal workflow run transitions
    assertions.push(assertEqual("pending→running", (() => { try { validateWorkflowRunTransition("pending", "running"); return "ok"; } catch { return "err"; } })(), "ok"));
    assertions.push(assertEqual("running→paused", (() => { try { validateWorkflowRunTransition("running", "paused"); return "ok"; } catch { return "err"; } })(), "ok"));
    assertions.push(assertEqual("running→completed", (() => { try { validateWorkflowRunTransition("running", "completed"); return "ok"; } catch { return "err"; } })(), "ok"));
    assertions.push(assertEqual("paused→running", (() => { try { validateWorkflowRunTransition("paused", "running"); return "ok"; } catch { return "err"; } })(), "ok"));

    // Illegal workflow run transitions
    assertions.push(assertEqual("completed→running throws", (() => { try { validateWorkflowRunTransition("completed", "running"); return "no-throw"; } catch (e) { return e instanceof IllegalTransitionError ? "ok" : "wrong"; } })(), "ok"));
    assertions.push(assertEqual("failed→pending throws", (() => { try { validateWorkflowRunTransition("failed", "pending"); return "no-throw"; } catch (e) { return e instanceof IllegalTransitionError ? "ok" : "wrong"; } })(), "ok"));
    assertions.push(assertEqual("cancelled→running throws", (() => { try { validateWorkflowRunTransition("cancelled", "running"); return "no-throw"; } catch (e) { return e instanceof IllegalTransitionError ? "ok" : "wrong"; } })(), "ok"));

    // Legal step transitions
    assertions.push(assertEqual("step pending→running", (() => { try { validateWorkflowStepTransition("pending", "running"); return "ok"; } catch { return "err"; } })(), "ok"));
    assertions.push(assertEqual("step running→completed", (() => { try { validateWorkflowStepTransition("running", "completed"); return "ok"; } catch { return "err"; } })(), "ok"));
    assertions.push(assertEqual("step running→waiting_for_approval", (() => { try { validateWorkflowStepTransition("running", "waiting_for_approval"); return "ok"; } catch { return "err"; } })(), "ok"));
    assertions.push(assertEqual("step paused→running", (() => { try { validateWorkflowStepTransition("paused", "running"); return "ok"; } catch { return "err"; } })(), "ok"));

    // Illegal step transitions
    assertions.push(assertEqual("step completed→running throws", (() => { try { validateWorkflowStepTransition("completed", "running"); return "no-throw"; } catch (e) { return e instanceof IllegalTransitionError ? "ok" : "wrong"; } })(), "ok"));
    assertions.push(assertEqual("step failed→pending throws", (() => { try { validateWorkflowStepTransition("failed", "pending"); return "no-throw"; } catch (e) { return e instanceof IllegalTransitionError ? "ok" : "wrong"; } })(), "ok"));

    // Retry eligibility (conservative v0.8 rule)
    assertions.push(assertTrue("retry allowed when idempotent=true", isRetryAllowed({ idempotent: true, safeToRetry: false })));
    assertions.push(assertTrue("retry allowed when safeToRetry=true", isRetryAllowed({ idempotent: false, safeToRetry: true })));
    assertions.push(assertTrue("retry allowed when both true", isRetryAllowed({ idempotent: true, safeToRetry: true })));
    assertions.push(assertTrue("retry rejected when idempotent=false and safeToRetry=false", !isRetryAllowed({ idempotent: false, safeToRetry: false })));
    assertions.push(assertTrue("retry rejected when both unknown", !isRetryAllowed({ idempotent: undefined as unknown as boolean, safeToRetry: undefined as unknown as boolean })));
    assertions.push(assertTrue("retry rejected when idempotent=unknown and safeToRetry not true", !isRetryAllowed({ idempotent: undefined as unknown as boolean, safeToRetry: false })));
    assertions.push(assertTrue("retry rejected when safeToRetry=unknown and idempotent not true", !isRetryAllowed({ idempotent: false, safeToRetry: undefined as unknown as boolean })));

    // Default policies exist
    assertions.push(assertEqual("defaultRetryPolicy maxAttempts", defaultRetryPolicy().maxAttempts, 1));
    assertions.push(assertEqual("defaultFailurePolicy defaultAction", defaultFailurePolicy().defaultAction, "stop"));

    return buildResult("workflow-run-state-transitions", "WorkflowRun and step state transitions are validated correctly", assertions, Date.now() - startedAt);
  }
};
