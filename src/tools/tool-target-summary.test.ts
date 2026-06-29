import { describe, expect, it } from "vitest";
import {
  buildToolDisplayPreview,
  buildToolSecurityTargetSummary,
  redactToolDisplayPreview
} from "./tool-target-summary.js";

describe("buildToolSecurityTargetSummary", () => {
  it("preserves the existing target field precedence", () => {
    expect(buildToolSecurityTargetSummary("file.search", { pattern: "import.*python-env|from.*python-env" })).toBe("import.*python-env|from.*python-env");
    expect(buildToolSecurityTargetSummary("web.search", { query: "faster-whisper gateway download" })).toBe("faster-whisper gateway download");
    expect(buildToolSecurityTargetSummary("image.generate", { prompt: "draw a square" })).toBe("draw a square");
    expect(buildToolSecurityTargetSummary("delegate_task", { goal: "audit channel progress rendering" })).toBe("audit channel progress rendering");
  });

  it("uses the first line for large text-like inputs", () => {
    expect(buildToolSecurityTargetSummary("execute_code", { code: "import os\nprint(os.getcwd())" })).toBe("import os");
    expect(buildToolSecurityTargetSummary("file.write", { content: "first line\nsecond line" })).toBe("first line");
  });

  it("preserves command and path precedence", () => {
    expect(buildToolSecurityTargetSummary("terminal.run", { command: "pnpm test", path: "src/app.ts" })).toBe("pnpm test");
    expect(buildToolSecurityTargetSummary("file.read", { path: "src/app.ts", query: "ignored" })).toBe("src/app.ts");
  });
});

describe("buildToolDisplayPreview", () => {
  it("formats file reads with line ranges for presentation only", () => {
    expect(buildToolDisplayPreview("file.read", {
      path: "src/app.ts",
      lineStart: 10,
      lineEnd: 20
    })).toBe("src/app.ts L10-20");
    expect(buildToolDisplayPreview("file.read", {
      path: "src/app.ts",
      lineStart: 10
    })).toBe("src/app.ts L10");
  });

  it("compacts shell commands for display without changing the security summary", () => {
    const input = {
      command: "cd app && export CI=true && pnpm test -- --runInBand && echo done"
    };

    expect(buildToolSecurityTargetSummary("terminal.run", input)).toBe("cd app && export CI=true && pnpm test -- --runInBand && echo done");
    expect(buildToolDisplayPreview("terminal.run", input)).toBe("pnpm test -- --runInBand");
  });

  it("redacts secret-bearing display previews", () => {
    expect(buildToolDisplayPreview("web.extract", {
      url: "https://example.com/search?token=abc123&q=docs"
    })).toBe("https://example.com/search?token=[redacted]&q=docs");
    expect(buildToolDisplayPreview("browser.type", {
      text: "password=hunter2"
    })).toBe("password=[redacted]");
    expect(redactToolDisplayPreview("Authorization: Bearer abc.def.ghi")).toBe("Authorization: Bearer [redacted]");
    expect(redactToolDisplayPreview("use sk-proj-secretvalue")).toBe("use [redacted]");
    expect(redactToolDisplayPreview("https://user:pass@example.com/private")).toBe("[redacted]");
  });

  it("summarizes delegate task batches", () => {
    expect(buildToolDisplayPreview("delegate_task", {
      tasks: [
        { task: "audit renderer flow" },
        { task: "add regression tests" },
        { task: "update docs" }
      ]
    })).toBe("audit renderer flow + 2 tasks");
  });

  it("falls back to security target summaries for ordinary tools", () => {
    expect(buildToolDisplayPreview("web.search", { query: "OpenAI Responses API" })).toBe("OpenAI Responses API");
    expect(buildToolDisplayPreview("browser.press", { key: "Enter" })).toBe("Enter");
  });
});
