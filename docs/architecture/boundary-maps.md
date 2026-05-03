---
title: "Boundary Maps"
description: "Cross-subsystem boundary analysis for memory, skills, provider loop, and observability."
---

# Boundary Maps

## Memory Boundary

```
┌───────────────────────────────────────────────────────┐
│  MemoryStore (bounded files)                          │
│  ───────────────────────────────────────────────────────  │
│  USER.md  ←──── LocalMemoryProvider ────→  AgentLoop  │
│  MEMORY.md ←─── (read/write/promote)   (frozen snapshot)   │
│  SOUL.md   ←─────────────────────────────────────────  │
└───────────────────────────────────────────────────────┘
```

**Inbound boundaries:**
- `AgentLoop` injects a frozen memory snapshot into the system prompt at session start.
- `LocalMemoryProvider` reads `USER.md`, `MEMORY.md`, `SOUL.md` from disk.
- `memory-promotion.ts` promotes repeated preferences and facts after the response path.

**Outbound boundaries:**
- `memory-tool.ts` lets the agent add/replace/remove entries.
- `memory-promotion.ts` writes promoted content back to disk.
- Changes during a session are persisted immediately but do not appear in the system prompt until the next session (frozen snapshot pattern).

**Crosses:**
- AgentLoop → LocalMemoryProvider (reads frozen snapshot)
- AgentLoop → memory-promotion (triggers post-run promotion)
- SkillLearningManager → MemoryStore (workflow learning state)

## Skill Runtime Boundary

```
┌───────────────────────────────────────────────────────┐
│  SkillRegistry                                          │
│  ───────────────────────────────────────────────────────  │
│  SkillLoader → skill-loader.ts                          │
│  SkillEvolutionStore → skill-evolution.ts                │
│  SkillLearningManager → skill-learning.ts               │
│  SkillTools → skill-tools.ts                            │
├───────────────────────────────────────────────────────┤
│  Consumers: AgentLoop, CLI slash commands, skill-tools    │
└───────────────────────────────────────────────────────┘
```

**Inbound boundaries:**
- `SkillLoader` loads from official, personal, project, and external roots.
- `SkillEvolutionStore` receives proposed patches from usage telemetry.
- `SkillLearningManager` observes workflow execution and creates project skills.

**Outbound boundaries:**
- `AgentLoop` reads selected skill instructions and resources.
- `SkillTools` exposes CRUD operations to the agent.
- `skill-mutation-policy.ts` enforces promotion gates.

**Crosses:**
- AgentLoop → SkillRegistry (read skill instructions)
- AgentLoop → SkillLearningManager (observe outcomes)
- SkillTools → SkillEvolutionStore (propose/approve/reject)
- SkillLearningManager → MemoryStore (workflow learning state)

## Provider–Tool Loop Boundary

```
┌───────────────────────────────────────────────────────┐
│  ProviderExecutor ←→ AgentLoop ←→ ToolExecutor           │
│  ───────────────────────────────────────────────────────  │
│  1. AgentLoop assembles prompt                              │
│  2. ProviderExecutor streams response                       │
│  3. AgentLoop extracts tool calls                           │
│  4. ToolCallPlanner converts to plans                       │
│  5. ToolExecutor runs tools under SecurityPolicy            │
│  6. AgentLoop builds continuation prompt                    │
│  7. Repeat until no tool calls or budget exhausted          │
└───────────────────────────────────────────────────────┘
```

**Key boundary:** The loop currently owns the iteration cycle. The provider does not know about tools; the tool executor does not know about providers. Only the loop bridges them.

**Risk:** The loop is the only place where provider responses, tool plans, security decisions, and memory promotion meet. This makes the loop irreplaceable without rewriting the entire system.

## Observability & Eval Boundary

```
┌───────────────────────────────────────────────────────┐
│  TrajectoryRecorder (97 lines, in-memory)                  │
│  ArtifactStore (56 lines, in-memory)                       │
│  ───────────────────────────────────────────────────────  │
│  Events captured:                                          │
│    - session-start, user-input, context-expanded           │
│    - skill-selected, skill-workflow-planned                │
│    - tool-plan, tool-call, tool-gated, tool-result         │
│    - artifact-created, memory-write                        │
│    - provider-completion, provider-continuation            │
│    - security-risk-escalated, agent-cancelled              │
│    - assistant-output, session-end                         │
└───────────────────────────────────────────────────────┘
```

**Current state:** Contracts define 32 event kinds. Implementation is a 97-line in-memory recorder with no persistence.

**Gap:** No run replay, no structured trace export, no eval dataset generation, no evidence corpus for self-evolution.

**v0.5 target:** Persistent trajectory store, structured trace schema, tool-call timeline, decision/event log, and basic eval runner.
