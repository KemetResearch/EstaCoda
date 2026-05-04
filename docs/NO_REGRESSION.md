# No-Regression Policy (v0.95)

Every change merged during the v0.95 UI/CLI overhaul must pass:

1. `bun run test` — authoritative unit-test gate (190 tests, all must pass).
2. `bun run typecheck` — TypeScript compilation with zero errors.
3. `bun run smoke` — integration smoke test must not crash.

## Test Gates

| Command | Runtime | Tests | Purpose |
|---------|---------|-------|---------|
| `bun run test` | Bun | 190 | Authoritative unit-test gate. Includes `bun:sqlite` tests. |
| `npm run test:node` | Node | 128 | Node-compatible gate. Excludes `bun:sqlite` tests. |
| `bun run typecheck` | Node/Bun | N/A | TypeScript type-checking gate. |
| `bun run smoke` | Bun | 3 | Runtime integration smoke test. |

## Rules

- Do not merge if `bun run test` fails.
- Do not merge if `bun run typecheck` fails.
- Do not merge if `bun run smoke` crashes.
- Existing behavior tests (`expect(output).toContain(...)`) must continue to pass without modification during v0.95.
- New snapshot tests are additive only.
- Backward-compatible wrappers must be preserved until v0.10.
