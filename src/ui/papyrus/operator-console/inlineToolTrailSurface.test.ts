import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import { formatInlineToolTrailRow } from "./inlineToolTrailSurface.js";

describe("Papyrus operator console inline tool trail surface", () => {
  it("formats running tool rows with active-work symbols and clock time", () => {
    const row = formatInlineToolTrailRow({
      id: "read-1",
      sequence: 1,
      toolName: "read_file",
      status: "running",
      summary: "src/cli/session-loop.ts",
      target: "src/cli/session-loop.ts",
      durationMs: 3_000,
    }, 72);

    expect(row).toContain("◷ read_file");
    expect(row).toContain("src/cli/session-loop.ts");
    expect(row).toContain("00:03");
    expect(stringWidth(row)).toBeLessThanOrEqual(72);
  });

  it("formats terminal tool statuses with the shared active-work grammar", () => {
    const succeeded = formatInlineToolTrailRow({
      id: "read-1",
      sequence: 1,
      toolName: "read_file",
      status: "succeeded",
      summary: "src/app.ts",
      durationMs: 1_000,
    }, 56);
    const failed = formatInlineToolTrailRow({
      id: "run-1",
      sequence: 2,
      toolName: "terminal.run",
      status: "failed",
      summary: "denied",
      durationMs: 0,
    }, 56);

    expect(succeeded).toContain("✓ read_file");
    expect(succeeded).toContain("00:01");
    expect(failed).toContain("✗ terminal.run");
    expect(failed).toContain("denied");
    expect(failed).toContain("00:00");
  });

  it("stays within narrow terminal widths", () => {
    const row = formatInlineToolTrailRow({
      id: "long-1",
      sequence: 1,
      toolName: "very_long_tool_name",
      status: "running",
      summary: "a/very/long/path/that/should/not/overflow.ts",
      durationMs: 12_000,
    }, 18);

    expect(stringWidth(row)).toBeLessThanOrEqual(18);
  });
});
