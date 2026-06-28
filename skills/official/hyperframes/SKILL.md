---
{
  "name": "hyperframes",
  "description": "Create rendered MP4/WebM motion graphics from HTML, CSS, JavaScript, GSAP, audio, and media assets.",
  "version": "1.0.0",
  "author": "heygen-com",
  "license": "Apache-2.0",
  "category": "creative",
  "origin": {
    "project": "Hermes Agent",
    "organization": "Nous Research",
    "url": "https://github.com/NousResearch/hermes-agent"
  },
  "routing": {
    "labels": [
      "hyperframes",
      "video",
      "animation",
      "html",
      "gsap",
      "motion-graphics"
    ],
    "triggerPatterns": [
      {
        "type": "contains",
        "value": "hyperframes"
      },
      {
        "type": "contains",
        "value": "html video"
      },
      {
        "type": "contains",
        "value": "motion graphics"
      },
      {
        "type": "contains",
        "value": "animated title card"
      },
      {
        "type": "contains",
        "value": "video overlay"
      }
    ],
    "requiredToolsets": [
      "files",
      "shell-write"
    ],
    "confirmation": "policy",
    "priority": 40
  },
  "intentLabels": [
    "creative",
    "video"
  ],
  "triggerPatterns": [
    "hyperframes",
    "html video",
    "motion graphics",
    "animated title",
    "video overlay"
  ],
  "whenToUse": [
    "The user wants a rendered MP4/WebM from an HTML composition.",
    "The user wants animated text, logos, charts, captions, or overlays over media.",
    "The user wants to turn a website or scripted visual sequence into a video."
  ],
  "requiredToolsets": [
    "files",
    "shell-write"
  ],
  "optionalToolsets": [
    "browser",
    "web",
    "media",
    "coding"
  ],
  "playbook": [
    {
      "id": "plan-composition",
      "description": "Define the video goal, dimensions, duration, visual identity, assets, audio needs, and render target.",
      "toolsets": [
        "files"
      ],
      "successCriteria": [
        "Composition requirements and visual direction are clear."
      ]
    },
    {
      "id": "author-html",
      "description": "Create or update the HyperFrames project files using deterministic HTML, CSS, JavaScript, and GSAP timelines.",
      "toolsets": [
        "files",
        "coding"
      ],
      "successCriteria": [
        "Project files exist and timeline rules are followed."
      ]
    },
    {
      "id": "validate-render",
      "description": "Run HyperFrames lint, validate, inspect, and render commands as appropriate and report output artifacts.",
      "toolsets": [
        "shell-write"
      ],
      "successCriteria": [
        "Validation or render results are reported with any remaining issues."
      ]
    }
  ],
  "permissionExpectations": [
    "auto-read",
    "ask-before-write",
    "ask-before-destructive-action"
  ],
  "examples": [
    "Create an animated title card with hyperframes.",
    "Make a captioned talking-head video.",
    "Build an audio-reactive visual with hyperframes."
  ],
  "evaluations": [
    {
      "input": "Create an animated title card with hyperframes",
      "shouldUseToolsets": [
        "files",
        "shell-write"
      ],
      "expectedOutcome": "The agent creates a HyperFrames composition and renders or validates an MP4/WebM output."
    }
  ]
}
---

# HyperFrames

HyperFrames is a video rendering engine that uses HTML as its native format. You author compositions as standard HTML files: CSS handles the look, GSAP handles the motion, and `data-*` attributes declare the timing. The engine then frame-captures the page and encodes the sequence into MP4 or WebM via FFmpeg.

**When to pair with `manim-video`:** Reserve `manim-video` for mathematical and geometric content (equations, 3Blue1Brown-style). Use `hyperframes` for motion graphics, talking-head captions, product tours, social overlays, shader transitions, and anything involving real video or audio assets.

## Scope

This skill fits when the user asks for:
- A rendered video derived from text, a script, or a live website
- Animated title cards, lower thirds, or typographic intros
- Captioned narration videos (TTS + word-level captions locked to waveform)
- Audio-reactive visuals (beat sync, spectrum bars, pulsing glow)
- Scene-to-scene transitions (crossfade, wipe, shader warp, flash-through-white)
- Social overlays (Instagram/TikTok/YouTube style)
- Website-to-video conversion (capture a URL, produce a promo)
- Any HTML/CSS/JS animation that must render deterministically to a video file

Avoid this skill for:
- Pure math or equation animation (→ `manim-video`)
- Image generation or memes (→ image models)
- Live video conferencing or streaming

## Command Overview

```bash
npx hyperframes init my-video               # scaffold a project
cd my-video
npx hyperframes lint                        # validate before preview/render
npx hyperframes preview                     # live-reload browser preview (port 3002)
npx hyperframes render --output final.mp4   # render to MP4
npx hyperframes doctor                      # diagnose environment issues
```

Render modifiers: `--quality draft|standard|high` · `--fps 24|30|60` · `--format mp4|webm` · `--docker` (reproducible) · `--strict`.

For the complete CLI surface: [references/cli.md](references/cli.md).

## Environment Setup (one-time)

```bash
bash "$(dirname "$(find ~/.estacoda -path '*/hyperframes/SKILL.md' 2>/dev/null | head -1)")/scripts/setup.sh"
```

The setup script performs four checks:
1. Confirms Node.js ≥ 22 and FFmpeg are present (emits fix instructions if missing).
2. Installs the `hyperframes` CLI globally at `>=0.4.2`.
3. Pre-caches `chrome-headless-shell` through Puppeteer — this binary is **required** for the high-quality `HeadlessExperimental.beginFrame` capture path.
4. Runs `npx hyperframes doctor` and surfaces the report.

If the script fails, consult [references/troubleshooting.md](references/troubleshooting.md).

## Authoring Workflow

### 1. Define the visual identity first

Before writing a single HTML tag, establish the creative direction:
- **Narrative** — arc, beats, emotional shifts
- **Structure** — compositions, tracks (video/audio/overlays), durations
- **Motion character** — explosive / cinematic / fluid / technical
- **Hero frame** — for every scene, the moment of maximum visual density. Build the static layout for this frame before adding any animation.

**Visual Identity Gate (HARD-GATE).** Never begin a composition without a locked visual identity. Generic defaults (`#333`, `#3b82f6`, `Roboto`) are signals that this gate was skipped. Resolve identity in this order:

1. **`DESIGN.md` exists at project root?** → Adopt its colors, fonts, motion rules, and anti-patterns verbatim.
2. **User supplied a named style** (e.g. "Swiss Pulse", "dark and techy")? → Generate a minimal `DESIGN.md`: `## Style Prompt`, `## Colors` (3–5 hexes with roles), `## Typography` (1–2 families), `## What NOT to Do` (3–5 rules).
3. **No direction given?** → Ask three questions:
   - Mood? (explosive / cinematic / fluid / technical / chaotic / warm)
   - Light or dark canvas?
   - Brand colors, fonts, or references?

   Then derive `DESIGN.md` from the answers. Every composition must trace its palette and typography back to this document or explicit user instruction.

### 2. Scaffold the project

```bash
npx hyperframes init my-video --non-interactive
```

Built-in templates: `blank`, `warm-grain`, `play-mode`, `swiss-grid`, `vignelli`, `decision-tree`, `kinetic-type`, `product-promo`, `nyt-graph`. Select with `--example <name>`. Seed media with `--video clip.mp4` or `--audio track.mp3`.

### 3. Build the static layout before animating

Start with the **hero frame** in plain HTML+CSS — no GSAP yet. The `.scene-content` container must fill the scene (`width:100%; height:100%; padding:Npx`) using `display:flex` + `gap`. Push content inward with padding — never use `position: absolute; top: Npx` on a content container, or it will overflow when the content exceeds the remaining space.

Once the hero frame is correct, add `gsap.from()` entrances (animating **to** the CSS position) and `gsap.to()` exits (animating **from** it).

For the full data-attribute contract and composition rules: [references/composition.md](references/composition.md).

### 4. Construct the GSAP timeline

Every composition must obey these constraints:
- Register its timeline: `window.__timelines["<composition-id>"] = tl`
- Start paused: `gsap.timeline({ paused: true })` — the player drives playback
- Use finite `repeat` values (never `repeat: -1` — this breaks the capture engine). Compute: `repeat: Math.ceil(duration / cycleDuration) - 1`
- Stay deterministic — no `Math.random()`, `Date.now()`, or wall-clock logic. Use a seeded PRNG if pseudo-randomness is required
- Build synchronously — no `async`/`await`, `setTimeout`, or Promises around timeline construction

For the GSAP API surface as it applies to HyperFrames: [references/gsap.md](references/gsap.md).

### 5. Bridge scenes with transitions

Multi-scene compositions require transitions. Obey these four rules:
1. **Always place a transition between scenes** — no jump cuts.
2. **Always animate entrances** on every scene element (`gsap.from(...)`).
3. **Never animate exits** except on the final scene — the transition itself serves as the exit.
4. The final scene may fade out.

Install shader transitions via `npx hyperframes add <transition-name>` (`flash-through-white`, `liquid-wipe`, etc.). List all options with `npx hyperframes add --list`.

### 6. Integrate audio, captions, TTS, audio-reactive effects, and highlighting

- **Audio:** always use a separate `<audio>` element. Video elements must carry `muted playsinline`.
- **TTS:** `npx hyperframes tts "Script text" --voice af_nova --output narration.wav`. List available voices with `--list`. The first letter of the voice ID encodes the language (`a`/`b`=English, `e`=Spanish, `f`=French, `j`=Japanese, `z`=Mandarin, etc.) — the CLI infers the phonemizer locale automatically; override with `--lang` only when necessary. Non-English phonemization requires system-wide `espeak-ng`.
- **Captions:** `npx hyperframes transcribe narration.wav` yields a word-level transcript. Select a caption style from the audio tone (hype / corporate / tutorial / storytelling / social — see `references/features.md`). **Critical language rule:** never use `.en` Whisper models unless the audio is confirmed English — `.en` translates non-English audio rather than transcribing it. Every caption group must include a hard `tl.set(el, { opacity: 0, visibility: "hidden" }, group.end)` kill after its exit tween, or the group will leak visibility into later segments.
- **Audio-reactive visuals:** pre-extract audio bands (bass / mid / treble) and sample per-frame inside the timeline using a `for` loop of `tl.call(draw, [], f / fps)` — a single extended tween cannot react to audio. Map bass → `scale` (pulse), treble → `textShadow`/`boxShadow` (glow), overall amplitude → `opacity`/`y`/`backgroundColor`. Avoid equalizer-bar clichés — let the content dictate the visual form, and let the audio modulate its behavior.
- **Marker-style highlighting:** highlight, circle, burst, scribble, and sketchout effects for text emphasis are implemented through deterministic CSS+GSAP — see `references/features.md#marker-highlighting`. These are fully seekable and do not rely on animated SVG filters.
- **Transitions:** every multi-scene composition must use transitions (no jump cuts). Choose from CSS primitives (push slide, blur crossfade, zoom through, staggered blocks) or shader transitions (`flash-through-white`, `liquid-wipe`, `cross-warp-morph`, `chromatic-split`, etc.) via `npx hyperframes add`. Mood and energy tables are in `references/features.md#transitions`. Do not mix CSS and shader transitions within the same composition.

### 7. Validate, preview, and render

```bash
npx hyperframes lint              # structural checks: missing data-composition-id, overlapping tracks, unregistered timelines
npx hyperframes validate          # WCAG contrast audit sampled at 5 timestamps
npx hyperframes inspect           # visual layout audit: overflow, off-frame elements, occluded text
npx hyperframes preview           # live browser preview
npx hyperframes render --quality draft --output draft.mp4    # fast iteration
npx hyperframes render --quality high --output final.mp4     # final delivery
```

`validate` samples background pixels behind every text element and flags contrast ratios below 4.5:1 (or 3:1 for large text). `inspect` runs the page at multiple timestamps to catch issues invisible to static lint: a caption that wraps past the safe area only at 4.5s, a card that overflows when its title is the longest variant, or an element occluded by a transition shader. Run `inspect` aggressively on compositions with speech bubbles, cards, captions, or tight typography.

### 8. Convert a website to video

When the user supplies a URL, follow the 7-step pipeline in [references/website-to-video.md](references/website-to-video.md): capture → DESIGN.md → SCRIPT.md → storyboard → composition → render → deliver.

## Common Traps

- **`HeadlessExperimental.beginFrame' wasn't found`** — Chromium 147+ removed this protocol. Ensure `hyperframes@>=0.4.2` (auto-detects and falls back to screenshot mode). Emergency override: `export PRODUCER_FORCE_SCREENSHOT=true`. See [hyperframes#294](https://github.com/heygen-com/hyperframes/issues/294) and [references/troubleshooting.md](references/troubleshooting.md).
- **System Chrome (not `chrome-headless-shell`)** — renders hang for 120s then timeout. `setup.sh` pre-installs `chrome-headless-shell` via Puppeteer. `hyperframes doctor` reports which binary is selected.
- **`repeat: -1` anywhere** — breaks the capture engine. Always compute a finite repeat count.
- **`gsap.set()` on clip elements that enter later** — the element does not exist at page load. Use `tl.set(selector, vars, timePosition)` inside the timeline, positioned at or after the clip's `data-start`.
- **`<br>` inside content text** — forced breaks are unaware of rendered font width, so natural wrap + `<br>` produces double-breaks. Use `max-width` to let text wrap naturally. Exception: short display titles where each word is intentionally isolated.
- **Animating `visibility` or `display`** — GSAP cannot tween these properties. Use `autoAlpha` (manages both visibility and opacity).
- **Calling `video.play()` or `audio.play()`** — the framework controls playback. Never invoke these directly.
- **Async timeline construction** — the capture engine reads `window.__timelines` synchronously after page load. Never wrap timeline construction in `async`, `setTimeout`, or a Promise.
- **Standalone `index.html` wrapped in `<template>`** — this hides all content from the browser. Only **sub-compositions** loaded via `data-composition-src` use `<template>`.
- **Using video for audio** — always pair muted `<video>` with a separate `<audio>` element.

## Quality Checklist

Before signing off on a render:

1. **Structural + visual + contrast audit:** `npx hyperframes lint --strict && npx hyperframes validate && npx hyperframes inspect` (lint catches structure, validate catches contrast, inspect catches layout/overflow — consult troubleshooting.md if warnings surface).
2. **Animation choreography review** — for new compositions or major animation changes, generate the animation map. `npx hyperframes init` copies skill scripts into the project, so the path is project-local:
   ```bash
   node skills/hyperframes/scripts/animation-map.mjs <composition-dir> \
     --out <composition-dir>/.hyperframes/anim-map
   ```
   This emits a single `animation-map.json` containing per-tween summaries, an ASCII Gantt timeline, stagger detection, dead zones (>1s without animation), element lifecycles, and flags (`offscreen`, `collision`, `invisible`, `paced-fast` <0.2s, `paced-slow` >2s). Review summaries and flags — fix or justify each. Skip on minor edits.
3. **Output sanity:** `ls -lh final.mp4` confirms existence and non-zero size.
4. **Duration accuracy:** `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 final.mp4` should match `data-duration`.
5. **Frame spot-check:** `ffmpeg -i final.mp4 -ss 00:00:05 -vframes 1 preview.png` extracts a mid-composition frame for visual inspection.
6. **Audio check (if applicable):** `ffprobe -v error -show_streams -select_streams a -of default=nw=1:nk=1 final.mp4 | head -1` confirms an audio stream exists.

If rendering fails, run `npx hyperframes doctor` and include its output in any bug report.

## References

- [composition.md](references/composition.md) — data attributes, timeline contract, non-negotiable rules, typography and asset guidelines
- [cli.md](references/cli.md) — full CLI surface: init, capture, lint, validate, inspect, preview, render, transcribe, tts, doctor, browser, info, upgrade, benchmark
- [gsap.md](references/gsap.md) — GSAP API tailored to HyperFrames: tweens, eases, stagger, timelines, matchMedia
- [features.md](references/features.md) — captions, TTS, audio-reactive visuals, marker highlighting, transitions (load on demand)
- [website-to-video.md](references/website-to-video.md) — 7-step capture-to-video pipeline
- [troubleshooting.md](references/troubleshooting.md) — OpenClaw compatibility, environment variables, common render failures
