# EstaCoda v2 Next Phase Roadmap

This phase turns the first working provider-backed agent loop into a reliable Hermes-class product core.

## Current Baseline

- Live provider inference works with Kimi.
- Live provider tool-calling works for `file.read`.
- Provider-safe tool aliases work, for example `file_read` maps to `file.read`.
- Trusted workspace execution works without repeated permission prompts.
- Tool results are packetized into continuation prompts.
- CLI tool activity is visible in one-shot and interactive sessions.
- `doctor --live-tools` can verify provider tool-calling against the configured model.

## Phase Goals

1. Make normal multi-step agent tasks reliable.
2. Make skills executable as reusable workflow packages.
3. Mature memory/session persistence into learning behavior.
4. Harden Telegram/channel runtime for real usage.
5. Finish first-run onboarding and packaging enough for outside users.

## Workstreams

### 1. Multi-Step Agent Tasks

Status: core loop exists, needs broader real-world hardening.

Next acceptance checks:
- Provider can write a file with `file.write`.
- Provider can read it back with `file.read`.
- Provider can verify final state from tool results.
- Failed or malformed tool calls produce recoverable feedback.
- Terminal activity shows each tool step clearly.

### 2. Executable Skills

Status: loading, routing, slash menu, import/export/create, workflow planning, and outcome memory exist.

Next acceptance checks:
- A skill can load `SKILL.md` and execute a multi-tool workflow.
- Skill steps can request files/context/tools without bespoke code.
- Skill outcomes are recorded to memory.
- Skill creation/import immediately updates slash menus and tool-visible catalog.

### 3. Memory And Sessions

Status: `SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`, memory provider, session DB, SQLite session store, history packing, and prompt cache exist.

Next acceptance checks:
- Repeated user preferences are promoted into `USER.md`.
- Repeated workflows are promoted into `MEMORY.md` or skills.
- Session summaries preserve active task state.
- Long sessions preserve recent tool-call/result pairs during compression.

### 4. Channels

Status: generic channel contracts, Telegram adapter, pairing, allowlists, media download, and gateway smoke tests exist.

Next acceptance checks:
- Telegram runs against the v2 provider/tool loop in a real session.
- Telegram media triggers attachment-aware skills.
- Gateway status and startup UX are clear.
- Channel approval/denial flows work for gated actions.

### 5. Installer And Onboarding

Status: setup CLI, interactive onboarding, provider config, onboarding tools, first-run path, and doctor checks exist.

Next acceptance checks:
- A fresh user can install, configure a model, trust a workspace, and complete a first prompt.
- Local model setup is supported cleanly.
- Config errors produce actionable fixes.
- Packaging path is defined for binary/npm/homebrew-style distribution.

## Immediate Next Step

Harden a normal multi-step provider workflow:

1. Provider requests `file.write`.
2. EstaCoda writes a file in the trusted workspace.
3. Provider requests `file.read`.
4. EstaCoda returns the written content.
5. Provider produces a final verification answer from the read result.

This should run through the normal agent loop, not a special doctor command.
