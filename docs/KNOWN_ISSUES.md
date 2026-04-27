# Known Issues

This file is intentionally blunt. It is for engineering continuity, not marketing.

## Runtime / provider

- The live provider hardening batch is now complete enough to establish a real acceptance matrix: Kimi, OpenAI, and DeepSeek passed; OpenRouter is operational but still weaker on exactness-sensitive tasks; local/Ollama is not validated in this environment. `live-proven`
- `doctor --live` can succeed with `[empty]` response text for some providers. `live-proven`
- Catalog-only providers are discovery adapters, not true inference adapters. `implemented`
- `openrouter/auto` is not currently acceptance-grade for tool workflows; live batch showed empty-success/no-tool behavior on the file roundtrip task. `live-proven`
- OpenRouter now works on the runtime/tool path with `qwen/qwen3.6-plus`, but it can still miss exact-content fidelity checks (for example, adding punctuation to “exact” file content). `live-proven`
- Local/Ollama support is architecturally present, but the current environment has no working local model route, so local acceptance remains unproven here. `live-proven`

## Memory

- Repeated preferences are not yet promoted automatically into `USER.md`. `intended but not implemented`
- Repeated workflows are not yet promoted automatically into `MEMORY.md` or skills. `intended but not implemented`
- Memory persistence exists, but “learning” is still shallow. skill outcomes `smoke-tested`; broader learning `intended but not implemented`

## Telegram / channels

- Telegram document analysis is live-proven; image understanding is now also live-proven with Kimi. broader provider coverage is still `implemented but not live-proven`
- On non-vision providers, Telegram image analysis currently degrades to metadata-only behavior rather than semantic image understanding. `live-proven`
- Native-vision routing is now preferred for simple image/OCR prompts on vision-capable main routes, but broader multi-provider live proof is still missing. `smoke-tested`
- Telegram final formatting is improved but still not full Hermes parity. formatting improvements `smoke-tested`; full parity `intended but not implemented`
- Channel verbosity/profile control is not implemented yet. `intended but not implemented`
- Gateway status reports readiness, not real background-process liveness. `live-proven`
- Telegram gateway session context is now persisted and policy-driven, but session-admin UX is still thin compared with Hermes. persistence/policy `smoke-tested`; admin UX `intended but not implemented`
- CLI still lacks cross-launch session resume. `live-proven`

## CLI / UX

- Interactive multiline paste ergonomics are still rough. `live-proven`
- Some answers remain too “assistant-ish” or too doc-like in tone/format depending on surface. `live-proven`

## Testing

- Smoke coverage is broad, but some live behaviors are only smoke-verified, not yet repeatedly operator-verified. `live-proven` as a process observation
- Internal alpha harness is manual and not yet a strict release gate. `live-proven`
- The evaluation substrate exists, but it is still a scaffold and not yet a scored automated benchmark system. `implemented but not live-proven`

## Architecture debt

- Provider message content support was widened to support vision, but the rest of the provider stack still assumes string content in many places conceptually. `implemented`
- There is still product logic mixed with formatting/delivery concerns in some channel paths. `implemented`
- Live provider capability detection still deserves a more explicit “this route can truly do vision” operator signal. `intended but not implemented`

## Product open edges

- Skills Hub/distribution layer is not implemented.
- Non-Telegram launch channels are not product-ready.
- Packaging/distribution path is not decided.
- Hermes/OpenClaw migration path is not designed.
- Voice input/transcription is not implemented.
- User-facing profiles/modes are not implemented.
- Update/install lifecycle for end users is not finalized.
