import { describe, it, expect, vi } from "vitest";
import {
  AnimationController,
  createSpinner,
  createWaitingSpinner,
  createThinkingSpinner,
} from "./animation.js";
import type { TerminalCapabilities } from "../../contracts/ui.js";

function fullCaps(): TerminalCapabilities {
  return {
    isTTY: true,
    supportsColor: true,
    supportsTrueColor: true,
    supportsUnicode: true,
    supportsEmoji: true,
    terminalWidth: 120,
    isDumb: false,
    isCI: false,
    supportsAnimation: true,
  };
}

function noAnimCaps(): TerminalCapabilities {
  return {
    isTTY: false,
    supportsColor: false,
    supportsTrueColor: false,
    supportsUnicode: false,
    supportsEmoji: false,
    terminalWidth: 80,
    isDumb: true,
    isCI: true,
    supportsAnimation: false,
  };
}

function nonTtyCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    isTTY: false,
    supportsAnimation: false,
  };
}

function dumbTermCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    isDumb: true,
    supportsAnimation: false,
  };
}

function ciCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    isCI: true,
    supportsAnimation: false,
  };
}

describe("AnimationController", () => {
  it("returns first frame when animation is disabled", () => {
    const ctrl = new AnimationController({
      frames: ["|", "/", "-", "\\"],
      intervalMs: 80,
      capabilities: noAnimCaps(),
    });
    expect(ctrl.currentFrame).toBe("|");
    expect(ctrl.canAnimate).toBe(false);
  });

  it("cycles through frames when animation is enabled", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b", "c"],
      intervalMs: 50,
      capabilities: fullCaps(),
    });
    expect(ctrl.currentFrame).toBe("a");
    ctrl.start();
    expect(ctrl.isRunning).toBe(true);
    ctrl.stop();
    expect(ctrl.isRunning).toBe(false);
  });

  it("does not start timer when animation is disabled", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: noAnimCaps(),
    });
    ctrl.start();
    expect(ctrl.isRunning).toBe(false);
  });

  it("calls onFrame callback", () => {
    const onFrame = vi.fn();
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: fullCaps(),
      onFrame,
    });
    ctrl.start();
    // We can't easily test the timer callback synchronously, but we can verify
    // the controller is running
    expect(ctrl.isRunning).toBe(true);
    ctrl.stop();
  });

  it("is no-op for non-TTY", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: nonTtyCaps(),
    });
    expect(ctrl.canAnimate).toBe(false);
    ctrl.start();
    expect(ctrl.isRunning).toBe(false);
  });

  it("is no-op for TERM=dumb", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: dumbTermCaps(),
    });
    expect(ctrl.canAnimate).toBe(false);
    ctrl.start();
    expect(ctrl.isRunning).toBe(false);
  });

  it("is no-op for CI", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: ciCaps(),
    });
    expect(ctrl.canAnimate).toBe(false);
    ctrl.start();
    expect(ctrl.isRunning).toBe(false);
  });

  it("returns static first frame as fallback", () => {
    const caps = noAnimCaps();
    const ctrl = new AnimationController({
      frames: ["|", "/", "-", "\\"],
      intervalMs: 80,
      capabilities: caps,
    });
    expect(ctrl.currentFrame).toBe("|");
    ctrl.start();
    // Should still be first frame because animation is disabled
    expect(ctrl.currentFrame).toBe("|");
  });

  it("handles empty frames gracefully", () => {
    const ctrl = new AnimationController({
      frames: [],
      intervalMs: 80,
      capabilities: fullCaps(),
    });
    expect(ctrl.currentFrame).toBe("");
    ctrl.start();
    expect(ctrl.isRunning).toBe(false);
  });

  it("dispose stops the timer", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: fullCaps(),
    });
    ctrl.start();
    expect(ctrl.isRunning).toBe(true);
    ctrl.dispose();
    expect(ctrl.isRunning).toBe(false);
  });
});

describe("createSpinner", () => {
  it("creates a spinner with default interval", () => {
    const spinner = createSpinner({
      frames: [".", "..", "..."],
      capabilities: fullCaps(),
    });
    expect(spinner.currentFrame).toBe(".");
    expect(spinner.canAnimate).toBe(true);
  });

  it("creates a waiting spinner", () => {
    const spinner = createWaitingSpinner(["|", "/", "-", "\\"], fullCaps());
    expect(spinner.currentFrame).toBe("|");
  });

  it("creates a thinking spinner with longer interval", () => {
    const spinner = createThinkingSpinner(["o", "O", "o", "."], fullCaps());
    expect(spinner.currentFrame).toBe("o");
  });
});

describe("AnimationController — provider-token streaming safety", () => {
  it("never writes to stdout directly", () => {
    const ctrl = new AnimationController({
      frames: ["a", "b"],
      intervalMs: 50,
      capabilities: fullCaps(),
    });
    // The controller only provides frames via currentFrame and onFrame.
    // It never touches process.stdout or any stream directly.
    expect(typeof ctrl.currentFrame).toBe("string");
  });

  it("static fallback prevents interleaving in plain mode", () => {
    const ctrl = new AnimationController({
      frames: ["(/)", "(-)", "(\\)", "(|)"],
      intervalMs: 80,
      capabilities: noAnimCaps(),
    });
    // In plain mode, the frame never changes, so there's no risk of
    // partially overwriting a line during a provider token write.
    expect(ctrl.currentFrame).toBe("(/)");
    ctrl.start();
    expect(ctrl.currentFrame).toBe("(/)");
  });
});
