import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import { resolveTokens } from "../../../theme/token-resolver.js";
import {
  createOperatorConsoleStyle,
  createDefaultStartupDashboardState,
  renderStartupDashboardSurface,
  type StartupDashboardState,
} from "./index.js";

describe("Papyrus operator console startup dashboard surface", () => {
  it("renders wide startup identity, startup seal, session, commands, and plain tips", () => {
    const output = renderStartupDashboardSurface(startupState(), { width: 80 });
    const text = output.join("\n");

    expect(output[0]).toContain("EstaCoda");
    expect(output[1]).toContain("Kemet Research");
    expect(output[2]).toContain("v0.1.0  𓂀  session 20ea8195");
    expect(text).not.toContain("sovereign agentic infrastructure");
    expect(text).toContain("v0.1.0");
    expect(text).toContain("session 20ea8195");
    expect(text).toContain("╭─ Runtime");
    expect(text).toContain("╭─ Commands");
    expect(text).toContain("model      kimi-k2.6 ◐");
    expect(text).toContain("context    0 / 262k");
    expect(text).toContain("workspace  verified");
    expect(text).toContain("approval   open");
    expect(text).toContain("autonomy   autonomous");
    expect(text).toContain("/tools");
    expect(text).toContain("/skills");
    expect(text).toContain("/model");
    expect(text).toContain("/status");
    expect(text).toContain("/compact");
    expect(text).toContain("Tips");
    expect(text).toContain("Paste large context as attachments.");
    expect(text).not.toContain("╭─ Tips");
    expect(output.every((line) => stringWidth(line) <= 80)).toBe(true);
  });

  it("stacks Runtime and Commands boxes in narrow layout", () => {
    const output = renderStartupDashboardSurface(startupState(), { width: 46 });
    const text = output.join("\n");
    const sessionIndex = output.findIndex((line) => line.includes("Runtime"));
    const commandsIndex = output.findIndex((line) => line.includes("Commands"));

    expect(text).toContain("EstaCoda");
    expect(text).toContain("Kemet Research");
    expect(text).toContain("v0.1.0  𓂀  session 20ea8195");
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    expect(commandsIndex).toBeGreaterThan(sessionIndex);
    expect(output.every((line) => stringWidth(line) <= 46)).toBe(true);
  });

  it("truncates long model, session, and tip text safely", () => {
    const output = renderStartupDashboardSurface({
      ...startupState(),
      sessionId: "20ea8195-with-an-extremely-long-suffix",
      session: {
        ...startupState().session,
        model: "kimi-k2.6-with-an-extremely-long-route-name ◐",
      },
      tips: ["Paste a very long context bundle as attachments instead of flooding the prompt surface."],
    }, { width: 44 });
    const text = output.join("\n");

    expect(text).not.toContain("extremely-long-route-name");
    expect(output.every((line) => stringWidth(line) <= 44)).toBe(true);
  });

  it("emits no ANSI escape sequences or cursor-control strings and does not mutate input", () => {
    const state = startupState();
    const before = JSON.stringify(state);
    const output = renderStartupDashboardSurface(state, { width: 80 }).join("\n");

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\x1b");
    expect(output).not.toContain("\\u001b");
    expect(output).not.toContain("\\033");
    expect(output).not.toMatch(/\b(moveCursor|clearLine|clearScreenDown|cursorTo|setRawMode)\b/u);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("provides deterministic fallback values", () => {
    const output = renderStartupDashboardSurface(createDefaultStartupDashboardState(), { width: 72 }).join("\n");

    expect(output).toContain("EstaCoda");
    expect(output).toContain("model pending");
    expect(output).toContain("/tools");
  });

  it("uses token colors for brand title, section labels, and model route dot when styled", () => {
    const tokens = resolveTokens("standard", "dark", "kemetBlue");
    const style = createOperatorConsoleStyle({
      tokens,
      capabilities: { supportsColor: true, supportsTrueColor: true },
    });
    const output = renderStartupDashboardSurface({
      ...startupState(),
      session: {
        ...startupState().session,
        modelRoute: "fallback",
      },
    }, { width: 80, style }).join("\n");

    expect(output).toContain(ansiFg(tokens.contract.palette.brand));
    expect(output).toContain(`${ansiFg(tokens.contract.text.secondary)}Runtime\x1b[0m`);
    expect(output).toContain(`${ansiFg(tokens.contract.text.secondary)}Commands\x1b[0m`);
    expect(output).toContain(`${ansiFg(tokens.contract.palette.caution)}◐\x1b[0m`);
  });
});

function startupState(): StartupDashboardState {
  return {
    productName: "EstaCoda",
    orgName: "Kemet Research",
    tagline: "sovereign agentic infrastructure",
    version: "v0.1.0",
    sessionId: "20ea8195",
    session: {
      model: "kimi-k2.6 ◐",
      context: "0 / 262k",
      workspace: "verified",
      security: "open",
      autonomy: "autonomous",
    },
    commands: [
      { command: "/tools", description: "inspect tools" },
      { command: "/skills", description: "loaded skills" },
      { command: "/model", description: "switch primary model" },
      { command: "/status", description: "runtime state" },
      { command: "/compact", description: "compact session context" },
    ],
    tips: [
      "Paste large context as attachments.",
      "Use /model to switch routes.",
      "Approvals appear inline when an action needs permission.",
    ],
  };
}

function ansiFg(hex: string): string {
  const clean = hex.replace("#", "");
  const bigint = Number.parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `\x1b[38;2;${r};${g};${b}m`;
}
