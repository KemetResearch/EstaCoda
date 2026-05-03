---
title: "Runtime Knowledge Graph"
description: "Concept-level map of how EstaCoda runtime components interact."
---

# Runtime Knowledge Graph

This page maps the conceptual relationships between runtime entities.

## Visualization

```mermaid
graph TB
    subgraph User["User Surfaces"]
        CLI["CLI (src/cli/)"]
        TELEGRAM["Telegram (src/channels/telegram-adapter.ts)"]
        CRON["Cron (src/cron/)"]
    end

    subgraph Runtime["Agent Runtime (src/runtime/)"]
        AL["AgentLoop<br/>Monolithic Orchestrator"]
        IR["IntentRouter<br/>Intent Classification"]
        CRT["createRuntime()<br/>Factory"]
    end

    subgraph Security["Security Layer (src/security/)"]
        SP["SecurityPolicy<br/>allow/ask/deny"]
        CSAF["CommandSafety<br/>Risk Assessment"]
        WTRUST["WorkspaceTrustStore"]
        WAPC["WorkspaceApprovalController"]
    end

    subgraph Skills["Skill System (src/skills/)"]
        SLOAD["SkillLoader<br/>Load bundled/local/external"]
        SREG["SkillRegistry<br/>Catalog & Lookup"]
        SWPLAN["SkillWorkflowPlanner<br/>Compile Plans"]
        SEVO["SkillEvolutionStore<br/>Propose Patches"]
        SLEARN["SkillLearningManager<br/>Telemetry & Learning"]
        STOOLS["SkillTools<br/>Skill-specific Tool Dispatch"]
    end

    subgraph Tools["Tool System (src/tools/)"]
        TEXEC["ToolExecutor<br/>Execute Tools"]
        TPLAN["ToolCallPlanner<br/>Plan Tool Calls"]
        TREG["ToolRegistry<br/>Tool Catalog"]
        TBUILTIN["Builtin Tools<br/>File, Shell, Search"]
        TWEB["Web Tools<br/>Fetch, Browse"]
        TCODE["Code Tools<br/>Execute Code"]
        TWS["Workspace Tools<br/>File Operations"]
    end

    subgraph Providers["Provider Layer (src/providers/)"]
        PEXEC["ProviderExecutor<br/>Call LLM"]
        PROUT["ProviderRouter<br/>Route to Provider"]
        OPEAI["OpenAICompatibleProvider<br/>Adapter"]
        AUXP["AuxiliaryProviderRouter<br/>Backup Routing"]
        CPOOL["CredentialPool<br/>Key Management"]
    end

    subgraph Memory["Memory Layer (src/memory/)"]
        MPROV["LocalMemoryProvider<br/>Memory Interface"]
        MSTORE["MemoryStore<br/>File Storage"]
        MRENDER["MemoryRenderer<br/>Prompt Packing"]
        MPROMO["MemoryPromotion<br/>Promotion Rules"]
        MSCAN["MemoryScanner<br/>Scan & Index"]
    end

    subgraph Session["Session Layer (src/session/)"]
        SDB["SessionDB<br/>In-Memory / SQLite"]
    end

    subgraph Prompt["Prompt Layer (src/prompt/)"]
        PASSEM["PromptAssembly<br/>Build Prompt"]
        HPACK["HistoryPacker<br/>Compress History"]
        PCACHE["PromptCache<br/>Cache Prompts"]
    end

    subgraph Trajectory["Trajectory Layer (src/trajectory/) — THIN"]
        TREC["TrajectoryRecorder<br/>97 lines"]
    end

    subgraph Artifacts["Artifact Layer (src/artifacts/) — THIN"]
        ASTORE["ArtifactStore<br/>56 lines"]
    end

    subgraph MCP["MCP Layer (src/mcp/)"]
        MCPCL["MCPClient<br/>External Tool Server"]
        MCPTL["MCPTools<br/>Tool Adapter"]
    end

    subgraph Cron["Cron Layer (src/cron/)"]
        CRUN["CronRunner<br/>Execute Scheduled Tasks"]
        CSTOR["CronStore<br/>Persist Jobs"]
        CSAF2["CronSafety<br/>Safety Checks"]
    end

    subgraph Channels["Channel Layer (src/channels/)"]
        CGATE["ChannelGateway<br/>Route Messages"]
        GWRUN["GatewayRunner<br/>Run Gateway"]
        CSSTORE["ChannelSessionStore<br/>Session Mapping"]
        CASTORE["ChannelApprovalStore<br/>Approval State"]
    end

    subgraph Config["Config Layer (src/config/)"]
        RCFG["RuntimeConfig<br/>Configuration"]
        ESECR["EnvSecretStore<br/>Secrets"]
    end

    %% Main data flows
    CLI --> AL
    TELEGRAM --> CGATE --> AL
    CRON --> CRUN --> AL

    AL --> IR
    AL --> SP
    AL --> SLOAD
    AL --> SREG
    AL --> SWPLAN
    AL --> STOOLS
    AL --> TEXEC
    AL --> TPLAN
    AL --> PEXEC
    AL --> MPROV
    AL --> PASSEM
    AL --> TREC
    AL --> ASTORE
    AL --> SDB

    IR --> SREG
    IR --> TBUILTIN

    SP --> CSAF
    SP --> WTRUST
    SP --> WAPC

    SLOAD --> SREG
    SEVO --> SREG
    SLEARN --> SREG
    STOOLS --> TEXEC
    SWPLAN --> TPLAN

    TEXEC --> TREG
    TEXEC --> TBUILTIN
    TEXEC --> TWEB
    TEXEC --> TCODE
    TEXEC --> TWS
    TEXEC --> CSAF

    PEXEC --> PROUT
    PEXEC --> OPEAI
    PEXEC --> AUXP
    PEXEC --> CPOOL

    MPROV --> MSTORE
    MPROV --> MRENDER
    MPROV --> MPROMO

    PASSEM --> HPACK
    PASSEM --> PCACHE
    PASSEM --> MRENDER
    PASSEM --> SDB

    TREC --> AL
    ASTORE --> AL

    CRT --> AL
    CRT --> IR
    CRT --> SP
    CRT --> SLOAD
    CRT --> SREG
    CRT --> STOOLS
    CRT --> TEXEC
    CRT --> TREG
    CRT --> PEXEC
    CRT --> MPROV
    CRT --> SDB
    CRT --> TREC
    CRT --> ASTORE
    CRT --> CGATE
    CRT --> CRUN
    CRT --> MCPCL

    %% Durable state
    MSTORE -.->|"Durable"| DISK1[("~/.estacoda/memory/")]
    SDB -.->|"Durable"| DISK2[("SQLite / In-Memory")]
    SREG -.->|"Durable"| DISK3[("~/.estacoda/skills/")]
    CSTOR -.->|"Durable"| DISK4[("~/.estacoda/cron/")]
    WTRUST -.->|"Durable"| DISK5[("~/.estacoda/workspace-trust.json")]
    SLEARN -.->|"Durable"| DISK6[("~/.estacoda/skill-learning.json")]

    style AL fill:#ff9999,stroke:#cc0000,stroke-width:2px
    style CRT fill:#ffcccc,stroke:#cc0000,stroke-width:2px
    style TREC fill:#ffeb99,stroke:#cc9900,stroke-width:2px
    style ASTORE fill:#ffeb99,stroke:#cc9900,stroke-width:2px
```

## Entity Descriptions

| Entity | Responsibility | File |
|--------|---------------|------|
| `AgentLoop` | Core turn orchestration | `src/runtime/agent-loop.ts` |
| `createRuntime` | Composition root | `src/runtime/create-runtime.ts` |
| `IntentRouter` | Native intent classification | `src/runtime/intent-router.ts` |
| `ProviderExecutor` | Streaming provider execution | `src/providers/provider-executor.ts` |
| `ToolExecutor` | Concrete tool execution | `src/tools/tool-executor.ts` |
| `ToolCallPlanner` | Plan conversion | `src/tools/tool-call-planner.ts` |
| `SkillRegistry` | Skill storage and visibility | `src/skills/skill-registry.ts` |
| `MemoryStore` | Bounded memory files | `src/memory/memory-store.ts` |
| `LocalMemoryProvider` | Memory read/write | `src/memory/local-memory-provider.ts` |
| `TrajectoryRecorder` | Event recording | `src/trajectory/trajectory-recorder.ts` |
| `ArtifactStore` | Artifact collection | `src/artifacts/artifact-store.ts` |
| `ChannelGateway` | Generic channel bridge | `src/channels/channel-gateway.ts` |
| `TelegramAdapter` | Telegram specifics | `src/channels/telegram-adapter.ts` |
| `SecurityPolicy` | Policy evaluation | `src/contracts/security.ts` |
| `WorkspaceTrustStore` | Trust grants | `src/security/workspace-trust-store.ts` |

## Generated

This graph was generated from static analysis of `src/runtime/agent-loop.ts` and `src/runtime/create-runtime.ts` on 2026-05-02.
