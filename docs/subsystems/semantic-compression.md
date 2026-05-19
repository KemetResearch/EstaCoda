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

Config keys:

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `compression.enabled` | boolean | `false` | Effective only when `experimental: true` is also set |
| `compression.experimental` | boolean | `false` | Required gate for semantic compression |
| `compression.threshold` | number | `0.50` | Clamped to `0.10`-`0.95`; compared against context length |
| `compression.targetRatio` | number | `0.20` | Clamped to `0.10`-`0.80`; target size for summarized middle history |
| `compression.protectFirstN` | integer | `3` | Number of leading messages protected from summarization |
| `compression.protectLastN` | integer | `20` | Number of trailing messages protected from summarization; minimum `1` |
| `compression.summaryModelContextLength` | integer | model context | Optional positive override for threshold calculations |

Example:

```json
{
  "compression": {
    "enabled": true,
    "experimental": true,
    "threshold": 0.5,
    "targetRatio": 0.2,
    "protectFirstN": 3,
    "protectLastN": 20
  },
  "auxiliaryModels": {
    "compression": { "provider": "openai", "id": "gpt-4.1-mini" }
  }
}
```

Malformed numeric values are normalized with NaN-safe coercion. Values outside supported ranges are clamped or defaulted.

## Runtime Paths

Provider-turn compression runs before prompt assembly when enabled and over threshold. It uses `SessionCompressionService.compactIfNeeded()` and the auxiliary route named `compression`.

Threshold checks use image-aware rough token estimation over persisted session messages. Image parts count toward pressure so multimodal sessions are less likely to be underestimated.

Manual session compaction is available through:

- interactive `/compact [topic]`
- `estacoda sessions compact <session-id> [--topic <topic>]`
- gateway `/compact [topic]`

Manual compaction uses `SessionCompressionService.compactNow()` and intentionally bypasses the threshold. It is still the same semantic session compression path, not TaskFlow compaction.

Gateway hygiene is gateway-only. It runs after session ID resolution and before runtime acquisition for normal gateway turns. It uses an 85% threshold and records compression events with `trigger: "hygiene"`. It skips gateway commands such as `/compact`, `/help`, and `/status`, and it skips drain/shutdown rejection paths.

Session replacement is transactional through `sessionDb.replaceMessages()`. Compression writes `session-history-compressed` and `session-compression-state` events best-effort; event failures are returned as warnings and do not undo a successful message replacement.

Manual output follows this shape:

```text
Compacted 47 messages -> 12 messages (~8200 tokens saved, 35%).
Focus topic: auth module
Token estimate: 14200 -> 6100
Session history compacted: 35 earlier message(s), saved about 8100 token(s).
Warning: auxiliary compression failed; used deterministic fallback
```

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

Repeated marginal compactions are suppressed by anti-thrashing logic. A session-level compression lock prevents concurrent compactions for the same session. Auxiliary compression uses a per-session scope key so unrelated sessions do not block each other.

Summary output is redacted and normalized with the current summary prefix. Legacy prefixes are tolerated. The current implementation does not structurally validate headings as a schema; malformed summaries are treated as historical context and remain subordinate to live instructions.

## Safety Boundaries

The summary is historical context. It must not override:

- system or developer instructions
- repo instructions such as `AGENTS.md`
- security policy
- the current user request
- persistent memory

Summarizer input and generated summary output are redacted with transcript-grade redaction. Tests cover API keys, bearer tokens, JWTs, env-style secrets, password assignments, URLs with credentials, and common tool-output secret fields.

The compressor preserves protected head/tail spans, the latest user message, active tool-call/tool-result pairs where metadata permits, security decisions, explicit constraints, unresolved approvals, and recent turns.

Older tool results may be pruned or summarized before LLM summarization. Provider-native tool call/result metadata is used where available to avoid orphaning active tool pairs.

## Distinctions

Semantic session compression:

- rewrites old session messages into a reference summary
- uses the `compression` auxiliary route
- is gated and experimental
- records compression state/events for diagnostics

Memory File Compaction:

- compacts `USER.md` or `MEMORY.md`
- uses the `memory_compaction` auxiliary route
- never compacts `SOUL.md` or `AGENTS.md`

TaskFlow compaction:

- belongs to TaskFlow state and `/flow compact <flowId>`
- is not invoked by semantic session compression or `/compact`

Deterministic history packing:

- is local prompt packing, not LLM summarization
- remains available when semantic compression is disabled
- is the fallback path when semantic summarization cannot run

## Not Implemented Here

This subsystem still does not provide:

- default-on semantic compression
- channel pointer rewrites
- archive tables
- vector search
- session recall changes
- memory-file compaction changes
- TaskFlow compaction changes
