import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeSkillsPackForceAuditRecord } from "./skills-pack-force-audit-log.js";

describe("writeSkillsPackForceAuditRecord", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-audit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a valid JSONL record", async () => {
    const record = {
      timestamp: new Date().toISOString(),
      skillsPackId: "test-sp",
      version: "1.0.0",
      manifestHash: "abc123",
      riskReasons: ["external untrusted"],
      overrideActor: "user@example.com"
    };

    await writeSkillsPackForceAuditRecord({ homeDir: tmpDir }, record);

    const auditPath = join(tmpDir, ".estacoda", "skills-packs", "audit", "force-overrides.jsonl");
    const content = readFileSync(auditPath, "utf8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.skillsPackId).toBe("test-sp");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.manifestHash).toBe("abc123");
    expect(parsed.riskReasons).toEqual(["external untrusted"]);
    expect(parsed.overrideActor).toBe("user@example.com");
    expect(parsed.timestamp).toBe(record.timestamp);
  });

  it("creates audit directory if missing", async () => {
    const record = {
      timestamp: new Date().toISOString(),
      skillsPackId: "test-sp",
      version: "1.0.0",
      manifestHash: "abc123",
      riskReasons: ["high risk"],
      overrideActor: "admin"
    };

    await writeSkillsPackForceAuditRecord({ homeDir: tmpDir }, record);

    const auditPath = join(tmpDir, ".estacoda", "skills-packs", "audit", "force-overrides.jsonl");
    expect(() => readFileSync(auditPath, "utf8")).not.toThrow();
  });

  it("appends multiple records", async () => {
    const record1 = {
      timestamp: new Date().toISOString(),
      skillsPackId: "sp-a",
      version: "1.0.0",
      manifestHash: "hash1",
      riskReasons: ["reason1"],
      overrideActor: "user1"
    };
    const record2 = {
      timestamp: new Date().toISOString(),
      skillsPackId: "sp-b",
      version: "2.0.0",
      manifestHash: "hash2",
      riskReasons: ["reason2"],
      overrideActor: "user2"
    };

    await writeSkillsPackForceAuditRecord({ homeDir: tmpDir }, record1);
    await writeSkillsPackForceAuditRecord({ homeDir: tmpDir }, record2);

    const auditPath = join(tmpDir, ".estacoda", "skills-packs", "audit", "force-overrides.jsonl");
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).skillsPackId).toBe("sp-a");
    expect(JSON.parse(lines[1]).skillsPackId).toBe("sp-b");
  });
});
