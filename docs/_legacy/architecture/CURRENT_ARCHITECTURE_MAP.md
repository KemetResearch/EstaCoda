# Current Architecture Map

## Purpose
Provide a code-grounded, file-level map of the EstaCoda v0.3 architecture showing what each module owns, what it depends on, and how it fits into the overall system.

## Scope
All 127 TypeScript source files, grouped by subsystem.

## Source Files Inspected
- All `src/**/*.ts` files
- `skills/official/*/SKILL.md`
- `package.json`, `tsconfig.json`

## Current-State Findings

### Entry Points

| File | Role | Lines | Imports |
|------|------|-------|---------|
| `src/index.ts` | Main entry point for `bun run dev` | 162 | 12 |
| `src/cli/cli.ts` | CLI entry point with interactive UI | 2,562 | 23 |
| `src/smoke.ts` | Smoke test runner | 13,969 | 89 |
| `src/acp/server.ts` | ACP server entry point | 1,716 | 13 |

### Runtime Core (src/runtime/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `agent-loop.ts` | **Monolithic turn-loop orchestrator.** Handles intent routing, security, skill workflow execution, provider loops, tool execution, memory promotion, trajectory recording, artifact handling, and prompt assembly. | 2,714 | `AgentLoop`, `AgentLoopInput`, `AgentLoopResponse`, `AgentLoopOptions`, `AgentLoopBudgets` |
| `create-runtime.ts` | **God factory.** Manually constructs and wires all subsystems: providers, tools, skills, memory, security, channels, cron, MCP, delegation, browser. | 830 | `createRuntime`, `Runtime`, `RuntimeOptions` |
| `intent-router.ts` | Intent classification and skill matching. Parses slash invocations, matches patterns, calculates confidence. | 546 | `IntentRouter` |

### Contracts (src/contracts/)

| File | Role | Lines | Key Types |
|------|------|-------|-----------|
| `tool.ts` | Tool type definitions | 54 | `ToolDefinition`, `ToolRiskClass`, `ToolsetName`, `ToolResult`, `ToolExecutionContext`, `ToolHandler`, `RegisteredTool` |
| `provider.ts` | Provider type definitions | 237 | `ModelProfile`, `ProviderMessage`, `ProviderRequest`, `ProviderResponse`, `ProviderAdapter`, `ProviderRoute`, `CredentialPoolEntry` |
| `skill.ts` | Skill type definitions | 222 | `SkillDefinition`, `LoadedSkill`, `SkillCatalogEntry`, `SkillWorkflowPlan`, `SkillWorkflowStep`, `SkillEvaluation`, `SkillSourceKind`, `SkillLifecycleState` |
| `security.ts` | Security type definitions | 124 | `SecurityDecision`, `SecurityRiskLevel`, `SecurityPolicy`, `SecurityContext`, `SecurityApprovalMode` |
| `channel.ts` | Channel type definitions | 141 | `ChannelKind`, `ChannelAttachment`, `ChannelMessage`, `ChannelGatewayConfig` |
| `session.ts` | Session type definitions | 305 | `SessionDB`, `SessionMessage`, `SessionRecord`, `SessionRole`, `SessionEvent` |
| `memory.ts` | Memory type definitions | 97 | `MemoryProvider`, `MemoryBudget`, `MemoryOperation`, `SkillOutcome`, `MemoryPromotionRecord` |
| `intent.ts` | Intent type definitions | 45 | `NativeIntent`, `IntentRoute`, `IntentRouteEvidence`, `SkillInvocation` |
| `trajectory.ts` | Trajectory type definitions | 60 | `TrajectoryEvent`, `Trajectory`, `CompressedTrajectory`, `TrajectoryEventKind` |
| `runtime-event.ts` | Runtime event type definitions | 104 | `RuntimeEvent`, `RuntimeEventSink` |
| `artifact.ts` | Artifact type definitions | 33 | `ArtifactRecord`, `isArtifactKind` |
| `tool-plan.ts` | Tool plan type definitions | 28 | `ToolCallPlan` |
| `prompt.ts` | Prompt type definitions | 49 | `PromptBudgetReport` |
| `context.ts` | Context type definitions | ~120 | `ContextExpansionResult`, `ProjectContextSnapshot` |
| `browser.ts` | Browser type definitions | ~110 | `BrowserBackend`, `BrowserPage`, `BrowserAction` |
| `image-generation.ts` | Image generation type definitions | ~100 | `ImageGenerationConfig`, `ImageGenerationRequest` |

### Skills (src/skills/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `skill-tools.ts` | **Skill tool dispatch and execution.** 2,292 lines — handles skill routing, skill tool calls, skill workflow execution, skill mutation, and skill metadata. | 2,292 | `createSkillTools`, `SkillToolSet`, `SkillMutationSet` |
| `skill-loader.ts` | Load skills from directories. Parses SKILL.md, validates structure, handles bundled/local/external sources. | 916 | `loadSkillsFromDirectory`, `parseSkillDefinition` |
| `skill-evolution.ts` | Skill evolution store. Proposes, reviews, approves, and promotes skill patches. | 665 | `SkillEvolutionStore`, `SkillPatchProposal`, `SkillPatchStatus` |
| `skill-learning.ts` | Skill learning manager. Records telemetry, learns from usage, manages autonomy thresholds. | 497 | `SkillLearningManager`, `SkillAutonomy` |
| `skill-bundled-sync.ts` | Sync bundled skills to local directory. Handles manifest tracking and origin hashes. | 417 | `syncBundledSkills`, `BundledManifest` |
| `skill-registry.ts` | Skill registry. Maintains catalog of loaded skills. | 199 | `SkillRegistry` |
| `skill-workflow-planner.ts` | Compile skill workflow plans from skill definitions. | 148 | `compileSkillWorkflowPlan` |
| `skill-mutation-policy.ts` | Policy for skill mutations. Determines what can be mutated and how. | 83 | `skillMutationPolicy`, `canMutateSkill` |
| `skill-curator-status.ts` | Curator status tracking for skill evolution. | 100 | `SkillCuratorStatus`, `listProposals`, `promotePatch` |
| `skill-usage-telemetry.ts` | Telemetry for skill usage. Route match counts, selection counts, confidence scores. | 41 | `createSkillRouteTelemetry`, `hashSkillRoutePrompt` |
| `skill-lifecycle.ts` | Skill lifecycle state management. | 48 | `SkillLifecycleState` transitions |
| `skill-path-safety.ts` | Path safety for skill file operations. | ~80 | `safeSkillPath`, `validateSkillPath` |
| `skill-visibility.ts` | Skill visibility evaluation. | ~60 | `evaluateSkillVisibility` |

### Tools (src/tools/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `tool-executor.ts` | Execute tools with context, risk checks, and result formatting. | 462 | `ToolExecutor`, `ToolExecutionRecord` |
| `web-tools.ts` | Web fetch and browse tools. | 731 | `createWebTools`, `FetchLike` |
| `workspace-tools.ts` | Workspace file operation tools. | 577 | `createWorkspaceTools`, `WorkspaceFsAdapter` |
| `tool-schema.ts` | Build provider-compatible tool schemas from tool definitions. | ~250 | `buildProviderToolSchemaCatalog`, `OpenAICompatibleToolSchema` |
| `tool-call-planner.ts` | Plan tool calls from provider responses. | 132 | `ToolCallPlanner` |
| `execute-code-tool.ts` | Execute code in sandboxed environment. | ~300 | `createExecuteCodeTool` |
| `image-generation-tools.ts` | Image generation tools. | ~300 | `createImageGenerationTools` |
| `vision-tools.ts` | Vision/image analysis tools. | ~200 | `createVisionTools`, `analyzeImageWithVision` |
| `voice-tools.ts` | Voice/speech tools. | ~200 | `createVoiceTools` |
| `media-tools.ts` | Media processing tools. | ~150 | `createMediaTools` |
| `python-tools.ts` | Python execution tools. | ~200 | `createPythonTools` |
| `tool-registry.ts` | Tool registry. Maintains catalog of registered tools. | 76 | `ToolRegistry` |
| `builtin-tools.ts` | Built-in tools (file, shell, search). | 68 | `builtinTools` |
| `tool-result-packet.ts` | Format tool results for provider consumption. | ~100 | `packetizeToolExecution`, `renderToolResultPacket` |

### Providers (src/providers/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `openai-compatible-provider.ts` | OpenAI-compatible provider adapter. Handles streaming, retries, errors. | 838 | `createOpenAICompatibleProvider` |
| `provider-executor.ts` | Execute provider calls with routing, fallback, and event streaming. | 465 | `ProviderExecutor`, `ProviderExecutionResult` |
| `auxiliary-provider-router.ts` | Route to auxiliary/backup providers when primary fails. | 184 | `AuxiliaryProviderRouter` |
| `provider-router.ts` | Route requests to appropriate provider based on model and preferences. | 83 | `ProviderRouter` |
| `provider-registry.ts` | Registry of available providers. | 41 | `ProviderRegistry` |
| `catalog-provider.ts` | Create catalog provider for model discovery. | 31 | `createCatalogProvider` |
| `provider-message-normalizer.ts` | Normalize messages between provider formats. | ~100 | `normalizeProviderMessagesStrict` |
| `credential-pool.ts` | Manage credential pools for provider authentication. | ~150 | `CredentialPoolRegistry` |
| `model-catalog.ts` | Catalog of known model profiles. | ~200 | `fallbackKnownModelProfiles`, `inferModelProfile` |

### Memory (src/memory/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `memory-promotion.ts` | Memory promotion rules. Determines what gets promoted to durable memory. | 326 | `resolveProjectFactPromotion`, `resolveUserPreferencePromotion`, `MemoryPromotionRule` |
| `memory-promotion-store.ts` | Store for memory promotion records. | 242 | `MemoryPromotionStore` |
| `local-memory-provider.ts` | Local file-based memory provider. | 187 | `LocalMemoryProvider` |
| `memory-store.ts` | Memory file storage operations. | 141 | `MemoryStore` |
| `memory-tool.ts` | Memory tool for agent self-management of memory. | 82 | `createMemoryTool` |
| `memory-renderer.ts` | Render memory into prompt-compatible format. | 60 | `renderMemoryForPrompt` |
| `memory-scanner.ts` | Scan memory files for indexing. | 36 | `scanMemoryFiles` |

### Security (src/security/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `security-policy-factory.ts` | Create security policies for different modes. | 422 | `createSecurityPolicyForMode`, `SecurityPolicy` implementations |
| `workspace-approval-controller.ts` | Manage workspace approval grants and checks. | 350 | `WorkspaceApprovalController` |
| `command-safety.ts` | Assess command safety and risk levels. | 172 | `assessCommandSafety`, `CommandSafetyResult` |
| `workspace-trust-store.ts` | Store and check workspace trust status. | 139 | `WorkspaceTrustStore` |
| `workspace-trust-tools.ts` | Tools for workspace trust management. | ~80 | `createWorkspaceTrustTools` |

### Channels (src/channels/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `channel-gateway.ts` | Gateway for all channel communication. | 1,408 | `ChannelGateway`, `ChannelGatewayConfig` |
| `telegram-adapter.ts` | Telegram Bot API adapter. | 847 | `TelegramAdapter`, `TelegramMessage` |
| `gateway-runner.ts` | Run channel gateway with polling/webhook. | 463 | `GatewayRunner` |
| `channel-session-store.ts` | Map channel users to sessions. | 294 | `ChannelSessionStore` |
| `channel-approval-store.ts` | Store approval state for channel-triggered actions. | 156 | `ChannelApprovalStore` |
| `activity-labels.ts` | Activity label definitions for channels. | ~50 | `ActivityLabels` |
| `voice-transcription.ts` | Voice transcription for channel inputs. | ~100 | `transcribeVoice` |
| `mock-channel-adapter.ts` | Mock adapter for testing. | ~50 | `MockChannelAdapter` |

### Prompt (src/prompt/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `prompt-assembly.ts` | Assemble full prompts from system, skills, memory, history. | 964 | `assembleProviderPrompt`, `assembleProviderContinuationPrompt` |
| `history-packer.ts` | Pack session history into provider message format. | 134 | `packSessionHistory` |
| `prompt-cache.ts` | Cache assembled prompts. | 47 | `PromptCache` |

### Session (src/session/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `sqlite-session-db.ts` | SQLite-backed session database. | 345 | `SqliteSessionDB` |
| `in-memory-session-db.ts` | In-memory session database. | 157 | `InMemorySessionDB` |

### Trajectory (src/trajectory/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `trajectory-recorder.ts` | Record trajectory events. | 97 | `TrajectoryRecorder`, `recordTrajectoryEvent` |

### Artifacts (src/artifacts/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `artifact-store.ts` | Store and retrieve artifacts. | 56 | `ArtifactStore` |

### MCP (src/mcp/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `mcp-client.ts` | MCP (Model Context Protocol) client. | 565 | `MCPClient`, `connectMcpServer` |
| `mcp-tools.ts` | Load tools from MCP servers. | 372 | `loadMcpServers`, `MCPServerSnapshot` |

### Cron (src/cron/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `cron-store.ts` | Store and manage cron jobs. | 355 | `CronStore` |
| `cron-runner.ts` | Execute cron jobs. | 306 | `CronRunner` |
| `cron-tools.ts` | Tools for cron job management. | 164 | `createCronTools` |
| `cron-safety.ts` | Safety checks for cron jobs. | 38 | `CronSafetyPolicy` |
| `cron-command.ts` | Cron command parsing. | ~100 | `parseCronCommand` |

### Config (src/config/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `runtime-config.ts` | Runtime configuration types, defaults, and loading. | 2,045 | `LoadedRuntimeConfig`, `AgentProfileMode`, `UiLanguage`, `UiFlavor`, `SecurityApprovalMode` |
| `config-tools.ts` | Tools for configuration management. | 564 | `createConfigTools` |
| `env-secret-store.ts` | Environment variable secret store. | 116 | `EnvSecretStore` |
| `provider-diagnostics.ts` | Provider diagnostics and health checks. | ~100 | `runProviderDiagnostics` |

### CLI (src/cli/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `cli.ts` | Main CLI with interactive UI, menus, and command handling. | 2,562 | `runCli`, `CliOptions` |
| `session-loop.ts` | Session interaction loop. | 906 | `runSessionLoop` |
| `interactive-select.ts` | Interactive selector UI components. | ~200 | `interactiveSelect` |
| `slash-menu.ts` | Slash command menu. | ~150 | `SlashMenu` |
| `tool-activity-renderer.ts` | Render tool activity in UI. | ~100 | `ToolActivityRenderer` |
| `one-shot.ts` | One-shot command execution. | ~100 | `runOneShot` |
| `cli-session-store.ts` | Store CLI session state. | ~80 | `CliSessionStore` |

### Onboarding (src/onboarding/)

| File | Role | Lines | Key Exports |
|------|------|-------|-------------|
| `interactive-onboarding.ts` | Interactive onboarding flow. | 1,155 | `runInteractiveOnboarding` |
| `onboarding-copy.ts` | Onboarding text and copy. | 956 | `onboardingCopy` |
| `onboarding-flow.ts` | Onboarding step definitions. | ~300 | `OnboardingFlow` |
| `onboarding-tools.ts` | Tools for onboarding. | ~100 | `createOnboardingTools` |
| `onboarding-provider-catalog.ts` | Provider catalog for onboarding. | ~100 | `ProviderCatalog` |
| `verification.ts` | Onboarding verification. | ~80 | `verifyOnboarding` |

## Current Boundaries

### Strong Boundaries
- **contracts/** → Pure types. No runtime logic. Clean import-only boundary.
- **config/** → Configuration loading. No business logic.
- **session/** → Session persistence. Abstracted via `SessionDB` interface.

### Moderate Boundaries
- **tools/** → Tool execution. Centralized via `ToolExecutor`, but tool files are numerous.
- **providers/** → Provider execution. Centralized via `ProviderExecutor`, but `openai-compatible-provider.ts` is large.
- **skills/** → Skill management. Multiple concerns mixed (loading, execution, evolution, learning).
- **security/** → Security decisions. Good separation but `security-policy-factory.ts` is complex.

### Weak Boundaries
- **runtime/** → `agent-loop.ts` is a monolith. `create-runtime.ts` is a god factory.
- **trajectory/** → Only 97 lines. Not a real subsystem yet.
- **artifacts/** → Only 56 lines. Not a real subsystem yet.
- **channels/** → `channel-gateway.ts` is large and coupled to `channel-session-store.ts`.

## Coupling Risks
1. **AgentLoop** directly imports 34 modules. Any subsystem change can affect it.
2. **create-runtime.ts** manually constructs 30+ objects. Constructor changes break the factory.
3. **skill-tools.ts** at 2,292 lines mixes skill execution, skill mutation, and skill metadata.
4. **cli.ts** at 2,562 lines mixes UI rendering, command handling, and session management.

## Evidence Status
- ✅ File-level ownership is clear.
- ✅ Key exports are documented in source.
- ✅ Directory structure matches subsystem boundaries.
- ⚠️ Some files exceed recommended size (AgentLoop, skill-tools, cli, create-runtime).
- ❌ Trajectory and artifact subsystems are underdeveloped.

## Open Questions
1. Should `skill-tools.ts` be split into execution, mutation, and metadata modules?
2. Should `cli.ts` be split into UI, command parsing, and session management?
3. What is the intended scope of `acp/server.ts` (1,716 lines)?

## Recommended Follow-Up Areas
- Decompose AgentLoop into planner/executor/recorder for v0.4.
- Split skill-tools.ts into smaller modules.
- Split cli.ts into smaller modules.
- Develop trajectory and artifact subsystems for v0.5.
