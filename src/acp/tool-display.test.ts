import { describe, expect, it } from "vitest";
import { acpToolExecutionTitle } from "./tool-display.js";

describe("ACP tool display", () => {
  it("renders display labels and compact previews without changing caller identity fields", () => {
    expect(acpToolExecutionTitle({
      tool: { name: "terminal.run" },
      input: { command: "cd app && export CI=true && pnpm test && echo done" },
      targetSummary: "cd app && export CI=true && pnpm test && echo done",
    })).toBe("Run Command(\"pnpm test\")");
  });

  it("uses dynamic MCP display labels while preserving server and tool tokens", () => {
    expect(acpToolExecutionTitle({
      tool: { name: "mcp.filesystem.read" },
      targetSummary: "src/app.ts",
    })).toBe("Filesystem Read(\"src/app.ts\")");
  });
});
