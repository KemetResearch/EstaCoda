# Contributing to EstaCoda

Thank you for contributing.

EstaCoda is agent infrastructure with local file and terminal access. Contributions should make the runtime more reliable, safer, easier to understand, or easier to maintain. Keep changes small, testable, and reversible.

---

## Development Posture

We value contributions in this order:

1. Bug fixes — crashes, incorrect behavior, data loss, broken setup, regressions.
2. Security hardening — shell command safety, path traversal prevention, workspace trust boundaries, secret redaction, approval logic.
3. Reliability — better error handling, recovery from malformed provider responses, deterministic tool execution, clearer diagnostics.
4. Cross-platform compatibility — macOS, Linux, WSL2, shell behavior across common terminals.
5. Agent and skill workflow improvements — safer skill loading, better intent routing, better evaluation fixtures.
6. Documentation — setup instructions, security explanations, architecture notes, troubleshooting examples.
7. New features — narrow, justified, and linked to an existing gap or limitation.

Good first contributions:

- Fix a reproducible bug.
- Add a missing test or smoke case.
- Improve an unclear error message.
- Improve setup or onboarding copy.
- Improve documentation for an existing behavior.
- Add a guardrail around an unsafe edge case.

Avoid as first contributions:

- Large architecture rewrites.
- New provider integrations without tests.
- New tools that duplicate existing skill behavior.
- Broad refactors with no user-visible improvement.
- Changes that weaken security prompts, workspace trust, or approval boundaries.

---

## Runtime Requirements

| Requirement | Notes |
|---|---|
| Git | Required for all contribution workflows. |
| Node.js >= 22.18.0 | Production runtime contract. |
| pnpm via Corepack | Use Corepack to activate the pnpm version declared in `package.json`. |
| Python 3.11+ | Optional — for Python-based skills and scripts. |

Bun is not required. Some scripts accept Bun as an optional dev-speed lane, but CI and production run on Node.

---

## Local Setup

```bash
git clone https://github.com/KemetResearch/EstaCoda.git
cd EstaCoda
corepack enable
pnpm install
```

If you are contributing from a fork:

```bash
git clone https://github.com:<your-username>/EstaCoda.git
cd EstaCoda
git remote add upstream https://github.com/KemetResearch/EstaCoda.git
corepack enable
pnpm install
```

Alternatively, run the repo setup script:

```bash
./scripts/setup-estacoda.sh
```

The script installs dependencies, builds the project, and offers to symlink a local wrapper.

### Environment

If the repo includes an example environment file, copy it:

```bash
cp .env.example .env
```

Then add only the keys needed for the workflow you are testing.

Rules:

- Never commit `.env`.
- Never commit real API keys.
- Never paste secrets into issues, pull requests, logs, screenshots, or test fixtures.
- Use obvious placeholders such as `TEST_OPENROUTER_API_KEY` in tests.

---

## Branch Workflow

Branch from the current `main`. Use short, descriptive names.

```text
fix/onboarding-selector-redraw
feat/provider-tool-recovery
docs/security-model
test/intent-router-fixtures
refactor/skill-catalog-loader
chore/update-ci
```

Keep pull requests scoped. Do not mix documentation and code churn without a clear reason. One logical change per PR.

Use Conventional Commits:

```text
<type>(<scope>): <description>
```

Common types: `fix`, `feat`, `docs`, `test`, `refactor`, `chore`, `security`.

---

## Validation

Run the checks that apply to your change.

Minimum local verification:

```bash
pnpm run typecheck
pnpm run test
pnpm run smoke
pnpm run build
```

If your change touches the compiled output or distribution:

```bash
pnpm run smoke:dist
pnpm run audit:esm
pnpm run audit:runtime-imports
```

If your change touches install, update, or uninstall behavior:

```bash
pnpm run validate:install
pnpm run validate:source-install
pnpm run validate:uninstall
```

If your change touches packaging:

```bash
pnpm run pack:dry-run
pnpm run verify:local-bin
```

If your change touches Docker:

```bash
pnpm run validate:docker
```

If your change touches provider tool-calling, run the relevant live or mocked provider check.

If your change touches install, onboarding, CLI rendering, terminal behavior, or filesystem paths, test manually in a fresh shell.

---

## Documentation Contribution Rules

Docusaurus source lives under `website/docs/`. Arabic mirrors live under `website/i18n/ar/docusaurus-plugin-content-docs/current/`.

Documentation must match the current release scope and implemented behavior. Do not document planned behavior that is not yet implemented.

Public docs must not contain marketing language. Use concrete, operator-focused prose. Every page should answer: what is this, why does it exist, when should the user care, how does it behave, what commands or files are involved, what can go wrong, and how does the user recover.

English is the canonical drafting source. Arabic documentation must mirror the full launch set where a launch-critical English page exists.

---

## Security and Safety Contribution Rules

Hard safety blocks are not optional. Do not bypass or weaken:

- Workspace trust checks
- Tool approval checks
- Path allowlists or denylists
- Secret redaction
- Prompt-injection filters
- Skill source trust logic
- Human review for promoted learned behavior
- Review gates for medium-risk or high-risk changes

Security-sensitive changes include anything touching terminal commands, file reads or writes, workspace trust, tool approvals, prompt construction, provider responses, skill loading, external skill directories, memory promotion, secrets, gateway or messaging integrations.

These changes require extra review and must not be bundled with unrelated refactors.

Do not commit generated or private artifacts unless they are explicitly intended for the repo.

---

## Pull Request Expectations

Before opening a pull request, confirm:

- The branch is up to date with `main`.
- All relevant validation scripts pass.
- `git diff --check` reports no whitespace errors.
- The change includes tests or smoke cases where practical.

In the PR description, include:

- What behavior changed and why.
- Which validation commands you ran.
- Known limitations or deferred work.
- Whether the change touches security-sensitive areas.

If an AI coding agent produced or significantly modified the code, disclose it and confirm that a human reviewed the diff manually.

---

## What Not To Do

- Do not claim unsupported providers or channels as stable.
- Do not bypass install ownership checks.
- Do not weaken state preservation.
- Do not commit generated or private artifacts unless intended.
- Do not describe Bun as required for normal development.
- Do not instruct contributors to publish npm packages.
- Do not include release-manager-only steps as normal contributor workflow.
