# EstaCoda Onboarding

EstaCoda starts with a guided first-run setup when no usable configuration is found. The goal is to get from a fresh checkout to a working local agent quickly, while keeping credentials and workspace trust explicit.

## First Launch

```bash
bun run dev
```

The setup flow walks through:

1. Interface language and expression style.
2. Workspace trust.
3. Primary provider and model.
4. Optional backup provider and model.
5. Protected API key capture into `~/.estacoda/.env`.
6. Security mode.
7. Workflow learning mode.
8. Optional capabilities such as Telegram, voice, vision, image generation, and browser automation.
9. A readiness check before entering the first agent session.

## Credentials

Hosted provider keys are stored locally in `~/.estacoda/.env` with restrictive file permissions. Runtime config stores only environment-variable names and non-secret settings.

Advanced users can point EstaCoda at an existing environment variable instead of pasting a key during setup.

## Workspace Trust

Workspace trust is path-scoped. A trusted workspace allows normal local file and terminal work under the configured security policy. An untrusted workspace keeps local actions conservative until the operator grants trust.

## Security Modes

EstaCoda uses three user-facing security modes:

- `strict`: asks before risky actions.
- `adaptive`: allows clearly safe actions, blocks clearly unsafe actions, and asks when risk is ambiguous.
- `open`: minimizes approval prompts, while hard safety blocks still apply.

`open` is not “security off”; the hard safety floor remains active.

## Workflow Learning

Workflow learning controls how proactive EstaCoda is about reusable workflows:

- `none`: no workflow learning or automatic skill creation.
- `suggest`: records candidates and suggests skill creation after repetition.
- `proactive`: creates project skills after repeated successful bounded local workflows.
- `autonomous`: creates project skills after the first successful bounded workflow; risky or external workflows remain candidates.

## Optional Capabilities

Optional capabilities can be configured during onboarding or later through CLI commands:

- Telegram for remote messages and updates.
- Voice for speech input and spoken replies.
- Vision and image generation.
- Browser automation.

These are additive. A user can skip them and start with the core terminal agent.
