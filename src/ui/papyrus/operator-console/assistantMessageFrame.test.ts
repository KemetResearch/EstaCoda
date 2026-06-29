import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import {
  getAssistantMessageFrameDesiredHeight,
  renderAssistantMessageFrame,
} from "./assistantMessageFrame.js";

describe("Papyrus operator console assistant message frame", () => {
  it("renders assistant text in the EstaCoda frame", () => {
    const rows = renderAssistantMessageFrame({
      lines: ["The stream should look like the settled assistant response."],
    }, { width: 72 });

    expect(rows[0]).toContain("EstaCoda");
    expect(rows).toContainEqual(expect.stringContaining("The stream should look like the settled assistant response."));
    expect(rows.at(-1)).toMatch(/^╰─+╯$/u);
    expect(rows.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("adds the live cursor only when requested", () => {
    const live = renderAssistantMessageFrame({
      lines: ["Still composing"],
      cursor: true,
    }, { width: 48 }).join("\n");
    const settled = renderAssistantMessageFrame({
      lines: ["Still composing"],
    }, { width: 48 }).join("\n");

    expect(live).toContain("Still composing▍");
    expect(settled).toContain("Still composing");
    expect(settled).not.toContain("▍");
  });

  it("summarizes without implementation chrome when height is constrained below a frame", () => {
    const rows = renderAssistantMessageFrame({
      lines: ["Constrained assistant output"],
      cursor: true,
    }, { width: 32, height: 1 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("EstaCoda: Constrained");
    expect(stringWidth(rows[0] ?? "")).toBeLessThanOrEqual(32);
    expect(rows.join("\n")).not.toContain("Assistant stream");
    expect(rows.join("\n")).not.toContain("assistant:");
  });

  it("reports frame desired height from wrapped content", () => {
    expect(getAssistantMessageFrameDesiredHeight({
      lines: ["short"],
    }, 80)).toBe(3);
    expect(getAssistantMessageFrameDesiredHeight({
      lines: ["This sentence wraps into multiple content rows at narrow width."],
    }, 24)).toBeGreaterThan(3);
  });
});
