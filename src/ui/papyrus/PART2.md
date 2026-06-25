# Papyrus Part 2 Porting Notes

Papyrus Part 2 covers widget state models, suggestion/typeahead models, raw
prompt overlays, and approval-card presentation for the no-React terminal
surface. These notes define the porting boundary before any widget or
suggestion implementation lands.

## Ownership

Papyrus widgets own UI state, focus, rendering models, overlays, and collected
user intent. They may model selected rows, input rows, focused controls,
overlay stacking, dialog state, and the intent a user chose from an interactive
surface.

Papyrus must not own command availability, approval grants, safety scopes,
hardline denials, runtime behavior, session behavior, provider capability
checks, workspace trust, persisted approval policy, or provider/runtime state.
Those remain EstaCoda-owned trust boundaries.

The EstaCoda slash command registry and existing slash menu behavior remain the
source of truth for slash command metadata, implemented-command filtering,
active-turn filtering, command availability, descriptions, and aliases. Papyrus
slash providers should wrap or extract that behavior rather than create a
parallel registry.

EstaCoda approval, session, and security logic remain the source of truth for
hardline denials, grant scopes, persistent grants, `grantApproval(...)`, and
approval side effects. Papyrus approval widgets may collect richer intent, such
as approve once, approve for session, ask user, feedback, amend, cancel, or
don't ask again, but EstaCoda core must interpret and authorize that intent.

## Reference Material

The Part 2 reference inventory is behavior guidance only. React, Ink, Yoga,
DOM, source-app absolute imports, analytics, source-app config/state, provider
helpers, and subprocess assumptions must be removed before any logic is ported.

Reference files should be decontaminated into pure state machines and explicit
render-row data. Do not copy component code or source-app integration code
directly into `src/ui/papyrus`.

## Deferred And Gated Surfaces

Shell history, clipboard, MCP suggestions, optional provider suggestions, Slack
suggestions, Vim keymaps, and other advanced prompt assistance must remain
gated or deferred until an explicit PR scopes the behavior, tests the boundary,
and documents the privacy or authorization risk.

Dependencies are added only in the commit that first consumes them in a tested
implementation. Do not add ranking, cache, clipboard, validation, or provider
packages for planned work before the consuming module exists.

## PR 7 Boundary

PR 7 is documentation and inert widget-model groundwork only. Commit 1 is
docs-only and must not add widget models, suggestion engines, slash
autocomplete, approval cards, CLI wiring, dependency changes, or runtime,
provider, session, or security behavior changes.
