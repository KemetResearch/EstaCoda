# Provider/Tool Loop Boundary Map

## Purpose
Explicitly map provider routing, execution, fallback, tool schema exposure, tool-call planning, tool execution, result formatting, continuation loops, security approval boundaries, and concurrency assumptions in the v0.3 codebase.

## Scope
All provider and tool code: `src/providers/*`, `src/tools/*`, `src/contracts/provider.ts`, `src/contracts/tool.ts`, `src/contracts/tool-plan.ts`, and provider/tool interactions in `src/runtime/agent-loop.ts`.

## Source Files Inspected
- `src/providers/provider-router.ts`
- `src/providers/provider-executor.ts`
- `src/providers/auxiliary-provider-router.ts`
- `src/providers/openai-compatible-provider.ts`
- `src/providers/provider-registry.ts`
- `src/providers/credential-pool.ts`
- `src/providers/provider-message-normalizer.ts`
- `src/tools/tool-executor.ts`
- `src/tools/tool-call-planner.ts`
- `src/tools/tool-registry.ts`
- `src/tools/builtin-tools.ts`
- `src/tools/tool-schema.ts`
- `src/tools/tool-result-packet.ts`
- `src/contracts/provider.ts`
- `src/contracts/tool.ts`
- `src/contracts/tool-plan.ts`
- `src/contracts/security.ts`
- `src/runtime/agent-loop.ts` (provider/tool loop sections)

## Provider Loop Distinctions

### 1. Provider Routing
- **What:** Decide which provider/model to use for a request.
- **Where:** `provider-router.ts` + `auxiliary-provider-router.ts`
- **Owner:** Provider layer
- **Boundary:** Router selects provider based on model profile, preferences, and health. Does not execute.
- **Evidence:** `ProviderRouter`, `ProviderRoute`, `ProviderRoutePreferences`.

### 2. Provider Execution
- **What:** Call the selected provider, handle streaming, retries, errors.
- **Where:** `provider-executor.ts` + `openai-compatible-provider.ts`
- **Owner:** Provider layer
- **Boundary:** Executor handles all provider I/O. Runtime sees only `ProviderExecutionResult`.
- **Evidence:** `ProviderExecutor`, `ProviderExecutionResult`, `ProviderStreamEvent`.

### 3. Auxiliary Provider Routing
- **What:** Route to backup providers when primary fails.
- **Where:** `auxiliary-provider-router.ts`
- **Owner:** Provider layer
- **Boundary:** Fallback is automatic based on provider health.
- **Evidence:** `AuxiliaryProviderRouter`, `AuxiliaryProviderConfig`, `AuxiliaryProviderTask`.

### 4. Provider Fallback
- **What:** Retry with different provider or model on failure.
- **Where:** `provider-executor.ts` handles fallback logic.
- **Owner:** Provider layer
- **Boundary:** Fallback is internal to executor. Runtime is not aware.
- **Evidence:** Fallback logic in `provider-executor.ts`.

## Tool Loop Distinctions

### 5. Tool Schema Exposure
- **What:** Generate provider-compatible tool schemas from tool definitions.
- **Where:** `tool-schema.ts`
- **Owner:** Tool layer
- **Boundary:** Schemas are exposed to provider but do not include internal tool logic.
- **Evidence:** `buildProviderToolSchemaCatalog()`, `OpenAICompatibleToolSchema`.

### 6. Tool-Call Planning
- **What:** Parse provider responses to extract tool calls and plan execution.
- **Where:** `tool-call-planner.ts`
- **Owner:** Tool layer
- **Boundary:** Planner creates `ToolCallPlan` objects. Does not execute.
- **Evidence:** `ToolCallPlanner`, `ToolCallPlan`.

### 7. Tool Execution
- **What:** Execute planned tool calls with context and security checks.
- **Where:** `tool-executor.ts`
- **Owner:** Tool layer
- **Boundary:** Executor is the single entry point for all tool execution. Enforces risk classification.
- **Evidence:** `ToolExecutor`, `ToolExecutionRecord`, `ToolExecutionContext`.

### 8. Tool Result Formatting
- **What:** Format tool results for provider consumption.
- **Where:** `tool-result-packet.ts`
- **Owner:** Tool layer
- **Boundary:** Results are packetized before being returned to provider.
- **Evidence:** `packetizeToolExecution()`, `renderToolResultPacket()`.

### 9. Continuation Loops
- **What:** After tool execution, continue provider conversation with results.
- **Where:** AgentLoop (lines ~1,757–1,869 in `agent-loop.ts`)
- **Owner:** Runtime
- **Boundary:** AgentLoop orchestrates the continuation. Provider layer handles the actual call.
- **Evidence:** `#continueProviderAfterTools()` in AgentLoop.

## Security Approval Boundaries

| Boundary | Enforced By | Status |
|----------|-------------|--------|
| Tool risk classification | `ToolRiskClass` in contracts | ✅ Every tool has a risk class |
| Security decision | `SecurityPolicy` + `assessSecurityPolicy()` | ✅ Allow/ask/deny per request |
| Command safety | `command-safety.ts` | ✅ Assesses shell command risk |
| Workspace approval | `workspace-approval-controller.ts` | ✅ Tracks user-approved operations |
| Tool execution gate | `tool-executor.ts` | ✅ Checks risk before execution |
| Provider iteration limit | `AgentLoopBudgets.maxProviderIterations` | ✅ Default 4 iterations |
| Tool call limit | `AgentLoopBudgets.maxProviderToolCalls` | ✅ Default 12 tool calls |
| Repeated failure limit | `AgentLoopBudgets.maxRepeatedToolFailures` | ✅ Default 2 failures |
| Wall clock limit | `AgentLoopBudgets.maxProviderWallClockMs` | ✅ Budget exists |
| Concurrent safe tool limit | `AgentLoopBudgets.maxConcurrentSafeTools` | ✅ Budget exists |

## Concurrency Assumptions

- **Tool Execution:** Sequential by default. `tool-executor.ts` does not show concurrent execution logic.
- **Provider Calls:** Sequential within a single AgentLoop. No concurrent provider calls in one turn.
- **Safe Tools:** `maxConcurrentSafeTools` suggests some concurrency for safe tools, but implementation is not evident in current code.
- **Channel Gateway:** May handle multiple concurrent sessions via `GatewayRunner`.

## Provider/Tool Loop Data Flow

```
AgentLoop.handle()
    ├──→ PromptAssembly — build prompt with tools schema
    ├──→ ProviderExecutor — send to LLM
    ├──← ProviderResponse — receive response
    ├──→ ToolCallPlanner — parse tool calls
    ├──→ SecurityPolicy — assess risk
    ├──→ ToolExecutor — execute tools
    ├──→ ToolResultPacket — format results
    └──→ (loop) — continue with results
```

## Coupling Risks

1. **AgentLoop → ProviderExecutor:** Direct. AgentLoop manages the full provider loop.
2. **AgentLoop → ToolCallPlanner:** Direct. AgentLoop plans and executes tools.
3. **AgentLoop → ToolExecutor:** Direct. AgentLoop dispatches tool execution.
4. **ProviderExecutor → OpenAICompatibleProvider:** Direct. Tight coupling to OpenAI-compatible adapter.
5. **ToolExecutor → ToolRegistry:** Direct. Executor looks up tools in registry.
6. **ToolSchema → ToolRegistry:** Direct. Schemas built from registry definitions.

## Evidence Status
- ✅ Provider routing and execution are separated.
- ✅ Tool planning and execution are separated.
- ✅ Security approval boundaries are well-defined.
- ✅ Budget limits exist for iterations, tool calls, failures, and wall clock.
- ⚠️ Tool-call planner is thin (132 lines) — may not handle complex plans.
- ⚠️ Concurrency model is not clearly documented.
- ❌ No explicit DAG for tool dependencies.

## Open Questions
1. How does the tool-call planner handle parallel tool calls?
2. What happens when `maxConcurrentSafeTools` is exceeded?
3. Is there a mechanism for tool dependencies (tool B requires tool A result)?
4. How does auxiliary provider routing interact with tool execution state?

## Recommended Follow-Up Areas
- Enhance tool-call planner with explicit DAG representation for v0.4.
- Document concurrency model for provider and tool execution.
- Add tool dependency resolution for v0.4.
- Clarify auxiliary provider behavior during multi-tool execution.
