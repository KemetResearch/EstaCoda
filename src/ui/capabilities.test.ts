import { describe, it, expect } from "vitest";
import type { TerminalCapabilities } from "../contracts/ui.js";
import {
  detectTerminalCapabilities,
  shouldAnimate,
  shouldUseEmoji,
} from "./capabilities.js";

describe("detectTerminalCapabilities", () => {
  it("returns defaults for a non-TTY stream with no env", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: false },
      env: {},
    });
    expect(caps.isTTY).toBe(false);
    expect(caps.supportsColor).toBe(false);
    expect(caps.supportsTrueColor).toBe(false);
    expect(caps.supportsUnicode).toBe(true); // empty locale defaults to true on non-win
    expect(caps.supportsEmoji).toBe(true);
    expect(caps.terminalWidth).toBe(80);
    expect(caps.isDumb).toBe(false);
    expect(caps.isCI).toBe(false);
    expect(caps.supportsAnimation).toBe(false);
  });

  it("detects a basic interactive TTY", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true, columns: 120 },
      env: { LANG: "en_US.UTF-8" },
    });
    expect(caps.isTTY).toBe(true);
    expect(caps.supportsColor).toBe(true);
    expect(caps.supportsTrueColor).toBe(false);
    expect(caps.supportsUnicode).toBe(true);
    expect(caps.supportsEmoji).toBe(true);
    expect(caps.terminalWidth).toBe(120);
    expect(caps.isDumb).toBe(false);
    expect(caps.isCI).toBe(false);
    expect(caps.supportsAnimation).toBe(true);
  });

  it("disables color when NO_COLOR is set", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true, columns: 80 },
      env: { NO_COLOR: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsColor).toBe(false);
    expect(caps.supportsTrueColor).toBe(false);
    expect(caps.supportsAnimation).toBe(false);
  });

  it("NO_COLOR=0 does not disable color", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { NO_COLOR: "0", LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsColor).toBe(true);
  });

  it("NO_COLOR=false does not disable color", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { NO_COLOR: "false", LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsColor).toBe(true);
  });

  it("enables color via FORCE_COLOR even without TTY", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: false },
      env: { FORCE_COLOR: "1" },
    });
    expect(caps.supportsColor).toBe(true);
    expect(caps.supportsTrueColor).toBe(false);
  });

  it("enables truecolor via FORCE_COLOR=3", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: false },
      env: { FORCE_COLOR: "3" },
    });
    expect(caps.supportsColor).toBe(true);
    expect(caps.supportsTrueColor).toBe(true);
  });

  it("FORCE_COLOR=true enables color but not truecolor", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: false },
      env: { FORCE_COLOR: "true" },
    });
    expect(caps.supportsColor).toBe(true);
    expect(caps.supportsTrueColor).toBe(true);
  });

  it("FORCE_COLOR=0 disables color", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { FORCE_COLOR: "0", LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsColor).toBe(false);
    expect(caps.supportsTrueColor).toBe(false);
  });

  it("NO_COLOR overrides FORCE_COLOR", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { NO_COLOR: "1", FORCE_COLOR: "3" },
    });
    expect(caps.supportsColor).toBe(false);
    expect(caps.supportsTrueColor).toBe(false);
  });

  it("detects COLORTERM=truecolor", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { COLORTERM: "truecolor", LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsTrueColor).toBe(true);
  });

  it("detects COLORTERM=24bit", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { COLORTERM: "24bit", LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsTrueColor).toBe(true);
  });

  it("disables everything for TERM=dumb", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true, columns: 80 },
      env: { TERM: "dumb", LANG: "en_US.UTF-8" },
    });
    expect(caps.isDumb).toBe(true);
    expect(caps.supportsColor).toBe(false);
    expect(caps.supportsTrueColor).toBe(false);
    expect(caps.supportsAnimation).toBe(false);
  });

  it("detects CI from CI=true", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { CI: "true", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
    expect(caps.supportsAnimation).toBe(false);
  });

  it("detects CI from GITHUB_ACTIONS", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { GITHUB_ACTIONS: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
    expect(caps.supportsAnimation).toBe(false);
  });

  it("detects CI from GITLAB_CI", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { GITLAB_CI: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("detects CI from CIRCLECI", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { CIRCLECI: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("detects CI from TRAVIS", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { TRAVIS: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("detects CI from BUILDKITE", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { BUILDKITE: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("detects CI from DRONE", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { DRONE: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("detects CI from APPVEYOR", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { APPVEYOR: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("detects CI from TF_BUILD", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { TF_BUILD: "1", LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(true);
  });

  it("allows animation when CI is not set even if TTY and color present", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8" },
    });
    expect(caps.isCI).toBe(false);
    expect(caps.supportsAnimation).toBe(true);
  });

  it("falls back to COLUMNS env when stream.columns is missing", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { COLUMNS: "120", LANG: "en_US.UTF-8" },
    });
    expect(caps.terminalWidth).toBe(120);
  });

  it("prefers stream.columns over COLUMNS env", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true, columns: 160 },
      env: { COLUMNS: "120", LANG: "en_US.UTF-8" },
    });
    expect(caps.terminalWidth).toBe(160);
  });

  it("defaults width to 80 when nothing provided", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8" },
    });
    expect(caps.terminalWidth).toBe(80);
  });

  it("handles invalid COLUMNS gracefully", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { COLUMNS: "abc", LANG: "en_US.UTF-8" },
    });
    expect(caps.terminalWidth).toBe(80);
  });

  it("detects Unicode from LANG with UTF-8", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8" },
    });
    expect(caps.supportsUnicode).toBe(true);
  });

  it("detects Unicode from LANG with utf8", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.utf8" },
    });
    expect(caps.supportsUnicode).toBe(true);
  });

  it("detects Unicode from LC_ALL", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LC_ALL: "C.UTF-8", LANG: "" },
    });
    expect(caps.supportsUnicode).toBe(true);
  });

  it("disables Unicode on non-UTF-8 locale", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "C" },
    });
    expect(caps.supportsUnicode).toBe(false);
  });

  it("disables Unicode on Windows without WT_SESSION", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8" },
      platform: "win32",
    });
    expect(caps.supportsUnicode).toBe(false);
  });

  it("enables Unicode on Windows with WT_SESSION", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8", WT_SESSION: "abc" },
      platform: "win32",
    });
    expect(caps.supportsUnicode).toBe(true);
  });

  it("enables Unicode on Windows with vscode terminal", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8", TERM_PROGRAM: "vscode" },
      platform: "win32",
    });
    expect(caps.supportsUnicode).toBe(true);
  });

  it("disables emoji via NO_EMOJI", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8", NO_EMOJI: "1" },
    });
    expect(caps.supportsEmoji).toBe(false);
  });

  it("disables emoji via ESTACODA_NO_EMOJI", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8", ESTACODA_NO_EMOJI: "1" },
    });
    expect(caps.supportsEmoji).toBe(false);
  });

  it("ESTACODA_NO_EMOJI=0 does not disable emoji", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "en_US.UTF-8", ESTACODA_NO_EMOJI: "0" },
    });
    expect(caps.supportsEmoji).toBe(true);
  });

  it("disables emoji when Unicode is disabled", () => {
    const caps = detectTerminalCapabilities({
      stream: { isTTY: true },
      env: { LANG: "C" },
    });
    expect(caps.supportsUnicode).toBe(false);
    expect(caps.supportsEmoji).toBe(false);
  });
});

describe("shouldAnimate", () => {
  it("returns true when supportsAnimation is true", () => {
    expect(shouldAnimate({ supportsAnimation: true } as TerminalCapabilities)).toBe(true);
  });

  it("returns false when supportsAnimation is false", () => {
    expect(shouldAnimate({ supportsAnimation: false } as TerminalCapabilities)).toBe(false);
  });
});

describe("shouldUseEmoji", () => {
  it("returns true when supportsEmoji is true and skin allows", () => {
    expect(shouldUseEmoji({ supportsEmoji: true } as TerminalCapabilities, true)).toBe(true);
  });

  it("returns false when supportsEmoji is false", () => {
    expect(shouldUseEmoji({ supportsEmoji: false } as TerminalCapabilities, true)).toBe(false);
  });

  it("returns false when skin disallows emoji", () => {
    expect(shouldUseEmoji({ supportsEmoji: true } as TerminalCapabilities, false)).toBe(false);
  });

  it("defaults skinAllowsEmoji to true", () => {
    expect(shouldUseEmoji({ supportsEmoji: true } as TerminalCapabilities)).toBe(true);
  });
});
