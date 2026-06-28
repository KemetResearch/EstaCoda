import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTokens } from "../theme/token-resolver.js";
import {
  createDefaultStatusRailState,
  createOperatorConsoleRuntimeHost,
  createOperatorConsoleStyle,
} from "../ui/papyrus/operator-console/index.js";
import { LiveOperatorConsoleController } from "./live-operator-console-controller.js";

describe("LiveOperatorConsoleController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances visible spinner frames on a timer while activity is active", () => {
    vi.useFakeTimers();
    const output = createOutput();
    const controller = createController(output);

    controller.setTurnActivity({ phase: "thinking" });
    expect(stripAnsi(output.text())).toContain("⣾⣷");

    output.clear();
    vi.advanceTimersByTime(90);

    expect(stripAnsi(output.text())).toContain("⣽⣯");
  });

  it("stops the animation timer when the live frame is cleared", () => {
    vi.useFakeTimers();
    const output = createOutput();
    const controller = createController(output);

    controller.setTurnActivity({ phase: "thinking" });
    controller.clear();
    output.clear();

    vi.advanceTimersByTime(180);

    expect(output.text()).toBe("");
  });

  it("does not restart animation from stale turn activity after turn cleanup", () => {
    vi.useFakeTimers();
    const output = createOutput();
    const controller = createController(output);

    controller.setTurnActivity({ phase: "thinking" });
    controller.clearTurnActivity();
    controller.clear();
    controller.resetActiveWork();
    output.clear();

    vi.advanceTimersByTime(180);

    expect(output.text()).toBe("");
  });
});

function createController(output: ReturnType<typeof createOutput>): LiveOperatorConsoleController {
  const status = createDefaultStatusRailState();
  const tokens = resolveTokens("standard", "dark", "kemetBlue");
  const runtimeHost = createOperatorConsoleRuntimeHost({
    status,
    terminal: { width: 80, height: 12, isTty: true },
    style: createOperatorConsoleStyle({
      tokens,
      capabilities: { supportsColor: true, supportsTrueColor: true },
    }),
  });
  return new LiveOperatorConsoleController({
    output,
    runtimeHost,
    terminal: { width: 80, height: 12, isTty: true },
    capabilities: { supportsAnimation: true },
    animationIntervalMs: 90,
    getStatus: () => status,
  });
}

function createOutput(): {
  readonly columns: number;
  readonly rows: number;
  readonly isTTY: boolean;
  write: (chunk: string | Uint8Array) => boolean;
  text: () => string;
  clear: () => void;
} {
  const writes: string[] = [];
  return {
    columns: 80,
    rows: 24,
    isTTY: true,
    write: (chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
    text: () => writes.join(""),
    clear: () => {
      writes.length = 0;
    },
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, "");
}
