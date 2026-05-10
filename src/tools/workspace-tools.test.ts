import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceTools } from "./workspace-tools.js";

let tempDir: string | undefined;

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "estacoda-workspace-tools-test-"));
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("workspace file change preview metadata", () => {
  it("attaches bounded preview metadata for file.write", async () => {
    const root = await makeTempDir();
    const tools = createWorkspaceTools({ workspaceRoot: root });
    const write = tools.find((tool) => tool.name === "file.write");

    const result = await write?.run({
      path: "notes.md",
      content: Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n"),
    });

    expect(result?.ok).toBe(true);
    expect(result?.metadata?.path).toBe("notes.md");
    expect(result?.metadata?.fileChangePreview).toMatchObject({
      kind: "fileChangePreview",
      path: "notes.md",
      changeType: "added",
      omittedLineCount: 2,
    });
    const preview = result?.metadata?.fileChangePreview as { diff?: string } | undefined;
    expect(preview?.diff).toContain("+ line 1");
    expect(preview?.diff).not.toContain("+ line 10");
  });

  it("attaches exact replacement preview metadata for file.replace", async () => {
    const root = await makeTempDir();
    await writeFile(join(root, "app.ts"), "const value = 1;\n", "utf8");
    const tools = createWorkspaceTools({ workspaceRoot: root });
    const replace = tools.find((tool) => tool.name === "file.replace");

    const result = await replace?.run({
      path: "app.ts",
      oldText: "const value = 1;",
      newText: "const value = 2;",
    });

    expect(result?.ok).toBe(true);
    expect(result?.metadata?.fileChangePreview).toMatchObject({
      kind: "fileChangePreview",
      path: "app.ts",
      changeType: "modified",
      omittedLineCount: 0,
    });
    const preview = result?.metadata?.fileChangePreview as { diff?: string } | undefined;
    expect(preview?.diff).toContain("- const value = 1;");
    expect(preview?.diff).toContain("+ const value = 2;");
  });
});
