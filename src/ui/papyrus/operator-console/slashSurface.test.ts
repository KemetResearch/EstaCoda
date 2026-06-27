import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import { resolveTokens } from "../../../theme/token-resolver.js";
import type { SlashMenuState } from "./operatorConsoleState.js";
import { createOperatorConsoleStyle, renderSlashSurface } from "./index.js";

describe("Papyrus operator console slash surface", () => {
  it("renders focused slash commands in a boxed menu", () => {
    const output = renderSlashSurface(slashMenu({ query: "/mo" }), { width: 72 });

    expect(output[0]).toContain("Commands");
    expect(output).toContainEqual(expect.stringContaining("❯ /model  show or change active model route"));
    expect(output).toContainEqual(expect.stringContaining("  /model setup  configure provider/model credentials"));
    expect(output.at(-1)).toMatch(/^╰/u);
  });

  it("renders command palette title for short slash prefix", () => {
    const output = renderSlashSurface(slashMenu({ query: "/s" }), { width: 72 });

    expect(output[0]).toContain("Command palette");
  });

  it("keeps narrow slash menu lines bounded and truncates safely", () => {
    const output = renderSlashSurface(slashMenu({
      items: [{
        id: "slash.model",
        label: "/model-with-a-very-long-name",
        detail: "show or change active model route with extra detail that should truncate",
      }],
    }), { width: 28 });

    expect(output.every((line) => stringWidth(line) <= 28)).toBe(true);
    expect(output.join("\n")).toContain("/model-with-a-very");
  });

  it("preserves mixed technical command tokens", () => {
    const output = renderSlashSurface(slashMenu({
      items: [{
        id: "slash.skills",
        label: "/skills",
        detail: "افحص MCP resources و src/cli/session-loop.ts",
      }],
    }), { width: 80 }).join("\n");

    expect(output).toContain("/skills");
    expect(output).toContain("MCP resources");
    expect(output).toContain("src/cli/session-loop.ts");
  });

  it("emits no ANSI escape sequences or cursor-control strings", () => {
    const output = renderSlashSurface(slashMenu(), { width: 72 }).join("\n");

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\x1b");
    expect(output).not.toMatch(/\b(moveCursor|clearLine|clearScreenDown|cursorTo|setRawMode)\b/u);
  });

  it("colors the selected command with the action token when styled", () => {
    const tokens = resolveTokens("standard", "dark", "kemetBlue");
    const output = renderSlashSurface(slashMenu(), {
      width: 72,
      style: createOperatorConsoleStyle({
        tokens,
        capabilities: { supportsColor: true, supportsTrueColor: true },
      }),
    }).join("\n");

    expect(output).toContain(`${ansiFg(tokens.contract.palette.action)}❯ /model`);
  });
});

function slashMenu(input: Partial<SlashMenuState> = {}): SlashMenuState {
  return {
    query: "/m",
    activeItemId: "slash.model",
    items: [
      {
        id: "slash.model",
        label: "/model",
        detail: "show or change active model route",
      },
      {
        id: "slash.model.setup",
        label: "/model setup",
        detail: "configure provider/model credentials",
      },
      {
        id: "slash.model.list",
        label: "/model list",
        detail: "list available models",
      },
    ],
    ...input,
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
