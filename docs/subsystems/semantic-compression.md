---
title: "Semantic Session Compression"
description: "Runtime semantic session compression gates, surfaces, fallback, and safety boundaries."
---

# Semantic Session Compression

Semantic session compression shortens older session history when a conversation grows too large. It is separate from Memory File Compaction and TaskFlow compaction.

## Status

Semantic compression is gated by runtime config:

- `compression.enabled` must normalize to `true`.
- `compression.experimental` must be `true`.
- Compression remains off by default.

There is no default-on semantic compression path. Enabling the config only allows the implemented runtime paths to call the shared compression service; it does not create an external memory provider, vector index, archive table, or session recall path.

## Runtime Paths

Provider-turn compression runs before prompt assembly when enabled and over threshold. It uses `SessionCompressionService.compactIfNeeded()` and the auxiliary route named `compression`.

Manual session compaction is available through:

- interactive `/compact [topic]`
- `estacoda sessions compact <session-id> [--topic <topic>]`
- gateway `/compact [topic]`

Manual compaction uses `SessionCompressionService.compactNow()` and intentionally bypasses the threshold. It is still the same semantic session compression path, not TaskFlow compaction.

Gateway hygiene is gateway-only. It runs after session ID resolution and before runtime acquisition for normal gateway turns. It uses an 85% threshold and records compression events with `trigger: "hygiene"`. It skips gateway commands such as `/compact`, `/help`, and `/status`, and it skips drain/shutdown rejection paths.

## Prompt Notice

When semantic compression has produced a compacted history, prompt assembly can include an in-memory `compaction-notice` layer. The notice is not persisted to the session DB or memory files.

The notice tells the model:

- compacted earlier turns are reference-only
- compacted content is not active instructions
- answer the latest user message after the summary
- persistent memory remains authoritative

## Fallback

The compressor first tries the configured auxiliary `compression` route. If provider summarization is unavailable or fails, it falls back to deterministic packing. Static emergency text is reserved for cases where deterministic packing cannot fit.

Event persistence is best-effort. Event write failures must not corrupt compressed messages or turn a successful compaction into a failed user turn.

## Safety Boundaries

The summary is historical context. It must not override:

- system or developer instructions
- repo instructions such as `AGENTS.md`
- security policy
- the current user request
- persistent memory

Summarizer input and generated summary output are redacted with transcript-grade redaction. Tests cover API keys, bearer tokens, JWTs, env-style secrets, password assignments, URLs with credentials, and common tool-output secret fields.

The compressor preserves protected head/tail spans, the latest user message, active tool-call/tool-result pairs where metadata permits, security decisions, explicit constraints, unresolved approvals, and recent turns.

## Distinctions

Semantic session compression:

- rewrites old session messages into a reference summary
- uses the `compression` auxiliary route
- is gated and experimental

Memory File Compaction:

- compacts `USER.md` or `MEMORY.md`
- uses the `memory_compaction` auxiliary route
- never compacts `SOUL.md` or `AGENTS.md`

TaskFlow compaction:

- belongs to TaskFlow state and `/flow compact <flowId>`
- is not invoked by semantic session compression or `/compact`

## Not Implemented Here

This subsystem still does not provide:

- default-on semantic compression
- channel pointer rewrites
- archive tables
- external memory providers
- vector search
- session recall changes
- memory-file compaction changes
- TaskFlow compaction changes
