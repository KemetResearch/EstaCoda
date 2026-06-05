import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillsFromDirectory } from "./skill-loader.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "estacoda-skill-loader-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("loadSkillsFromDirectory", () => {
  it("returns empty skills and errors when the directory does not exist", async () => {
    const missingDir = join(tmpdir(), "estacoda-skill-loader-does-not-exist-" + Date.now());
    const result = await loadSkillsFromDirectory(missingDir, {
      sourceKind: "external",
      sourceRoot: missingDir
    });
    expect(result.skills).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for malformed SKILL.md files in an existing directory", async () => {
    const root = await makeTempDir();
    const skillDir = join(root, "bad-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "not valid frontmatter", "utf8");

    const result = await loadSkillsFromDirectory(root, {
      sourceKind: "local",
      sourceRoot: root
    });
    expect(result.skills).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("frontmatter");
  });

  it("loads a valid SKILL.md from an existing directory", async () => {
    const root = await makeTempDir();
    const skillDir = join(root, "valid-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: valid-skill\ndescription: A valid test skill\nversion: 1.0.0\ncategory: test\n---\nDo the thing.\n",
      "utf8"
    );

    const result = await loadSkillsFromDirectory(root, {
      sourceKind: "local",
      sourceRoot: root
    });
    expect(result.errors).toHaveLength(0);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("valid-skill");
  });
});
