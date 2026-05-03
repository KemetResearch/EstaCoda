---
title: "Architecture"
description: "System structure, runtime composition, data flow, and decomposition targets."
---

# Architecture

This section describes how EstaCoda is structured, how components compose, and where the architecture is healthy vs. strained.

All statements here are grounded in the current codebase. If a feature is not implemented, it is labeled as such.

## Sections

| Doc | Purpose |
|-----|---------|
| [Overview](./overview.md) | High-level system map, entrypoints, composition root, and data flow |
| [Runtime Components](./runtime-components.md) | Breakdown of the runtime: AgentLoop, createRuntime, registries, executors |
| [Decomposition Targets](./decomposition-targets.md) | v0.4 agent-loop decomposition plan and acceptance criteria |
| [Dependency Graph](./dependency-graph.md) | Module-level dependency graph with Mermaid visualization |
| [Runtime Knowledge Graph](./runtime-knowledge-graph.md) | Runtime concept map with Mermaid visualization |
| [Boundary Maps](./boundary-maps.md) | Cross-subsystem boundary analysis: memory, skills, provider loop, observability |
| [Risk Register](./risk-register.md) | Architecture risks, severity, and mitigation |
