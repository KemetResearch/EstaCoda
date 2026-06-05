import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGlobTools } from "./glob-tools.js";

let tempDir: string | undefined;

async function makeTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "estacoda-glob-tools-test-"));
  return tempDir;
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("file.glob", () => {
  it("uses the rg backend when ripgrep is available", async () => {
    const root = await makeTempDir();
    const scriptPath = join(root, "fake-rg.mjs");
    await writeFile(scriptPath, [
      "console.log(['src/index.ts', '.env', 'node_modules/pkg/index.ts'].join('\\n'));"
    ].join("\n"), "utf8");
    const glob = createGlobTools({
      workspaceRoot: root,
      rgCommand: process.execPath,
      rgArgsPrefix: [scriptPath]
    })[0]!;

    const result = await glob.run({ pattern: "*.ts" });

    expect(result.ok).toBe(true);
    expect(result.metadata?.backend).toBe("rg");
    expect(result.content).toBe("src/index.ts");
  });

  it("treats rg no-match exit code 1 with empty stdout as a successful no-match result", async () => {
    const root = await makeTempDir();
    const scriptPath = join(root, "fake-rg-no-match.mjs");
    await writeFile(scriptPath, "process.exit(1);\n", "utf8");
    const glob = createGlobTools({
      workspaceRoot: root,
      rgCommand: process.execPath,
      rgArgsPrefix: [scriptPath]
    })[0]!;

    const result = await glob.run({ pattern: "*.missing" });

    expect(result.ok).toBe(true);
    expect(result.content).toBe("No files found.");
    expect(result.metadata).toMatchObject({
      backend: "rg",
      numFiles: 0,
      returned: 0,
      truncated: false
    });
  });

  it("falls back to the node backend when rg is unavailable", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts" });

    expect(result.ok).toBe(true);
    expect(result.metadata?.backend).toBe("node");
    expect(lines(result)).toEqual(["README.ts", "src/app.ts", "src/util.test.ts"]);
  });

  it("supports ** patterns in the node fallback", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "src/**/*.ts" });

    expect(result.ok).toBe(true);
    expect(lines(result)).toEqual(["src/app.ts", "src/util.test.ts"]);
  });

  it("supports ? patterns in the node fallback", async () => {
    const root = await makeWorkspace();
    await writeFile(join(root, "src", "a1.ts"), "a1", "utf8");
    await writeFile(join(root, "src", "ab.ts"), "ab", "utf8");
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "src/a?.ts" });

    expect(result.ok).toBe(true);
    expect(lines(result)).toEqual(["src/a1.ts", "src/ab.ts"]);
  });

  it("supports basic {a,b} groups in the node fallback", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "src/*.{ts,md}" });

    expect(result.ok).toBe(true);
    expect(lines(result)).toEqual(["src/app.ts", "src/notes.md", "src/util.test.ts"]);
  });

  it("excludes dotfiles by default and includes non-sensitive hidden files when requested", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const hiddenOff = await glob.run({ pattern: "*.ts" });
    const hiddenOn = await glob.run({ pattern: "*.ts", include_hidden: true });

    expect(lines(hiddenOff)).not.toContain(".hidden.ts");
    expect(lines(hiddenOn)).toContain(".hidden.ts");
  });

  it("excludes sensitive files even when hidden files are included", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*", include_hidden: true, limit: 1_000 });

    expect(lines(result)).not.toContain(".env");
    expect(lines(result)).not.toContain("secrets/private.key");
    expect(lines(result)).not.toContain("secrets/id_rsa");
  });

  it("rejects traversal outside the workspace", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts", path: "../outside" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("outside the trusted workspace");
  });

  it("scopes searches to a subdirectory", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts", path: "src" });

    expect(lines(result)).toEqual(["src/app.ts", "src/util.test.ts"]);
  });

  it("paginates after sorting by path", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts", limit: 1, offset: 1 });

    expect(result.ok).toBe(true);
    expect(lines(result)).toEqual(["src/app.ts"]);
    expect(result.metadata).toMatchObject({
      returned: 1,
      truncated: true,
      offset: 1,
      limit: 1,
      sort: "path"
    });
  });

  it("sorts by modified time descending", async () => {
    const root = await makeWorkspace();
    const older = new Date("2024-01-01T00:00:00Z");
    const middle = new Date("2024-01-01T12:00:00Z");
    const newer = new Date("2024-01-02T00:00:00Z");
    await utimes(join(root, "src", "app.ts"), older, older);
    await utimes(join(root, "src", "util.test.ts"), middle, middle);
    await utimes(join(root, "README.ts"), newer, newer);
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts", sort: "modified" });

    expect(lines(result)[0]).toBe("README.ts");
    expect(result.metadata?.sort).toBe("modified");
  });

  it("rejects file paths because path must be a directory", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts", path: "src/app.ts" });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("path must point to a directory");
  });

  it("rejects invalid and unlimited-style limits", async () => {
    const root = await makeWorkspace();
    const glob = createGlobTools({ workspaceRoot: root, rgCommand: "estacoda-rg-missing-for-test" })[0]!;

    const result = await glob.run({ pattern: "*.ts", limit: 0 });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("limit must be between 1 and 1000");
  });
});

async function makeWorkspace(): Promise<string> {
  const root = await makeTempDir();
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "secrets"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "README.ts"), "root ts", "utf8");
  await writeFile(join(root, "src", "app.ts"), "app", "utf8");
  await writeFile(join(root, "src", "util.test.ts"), "test", "utf8");
  await writeFile(join(root, "src", "notes.md"), "notes", "utf8");
  await writeFile(join(root, ".hidden.ts"), "hidden", "utf8");
  await writeFile(join(root, ".env"), "secret", "utf8");
  await writeFile(join(root, "secrets", "private.key"), "secret", "utf8");
  await writeFile(join(root, "secrets", "id_rsa"), "secret", "utf8");
  await writeFile(join(root, "node_modules", "pkg", "index.ts"), "generated", "utf8");
  await writeFile(join(root, ".git", "config"), "git", "utf8");
  return root;
}

function lines(result: Awaited<ReturnType<ReturnType<typeof createGlobTools>[number]["run"]>> | undefined): string[] {
  if (result === undefined || result.content === "No files found.") {
    return [];
  }
  return result.content.split("\n");
}
