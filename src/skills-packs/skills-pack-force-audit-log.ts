import { mkdir } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillsPackForceAuditRecord } from "../contracts/skills-pack.js";

export type SkillsPackForceAuditLogOptions = {
  homeDir: string;
};

export async function writeSkillsPackForceAuditRecord(options: SkillsPackForceAuditLogOptions, record: SkillsPackForceAuditRecord): Promise<void> {
  const auditDir = join(options.homeDir, ".estacoda", "skills-packs", "audit");
  const auditPath = join(auditDir, "force-overrides.jsonl");

  await mkdir(auditDir, { recursive: true });

  const line = JSON.stringify(record) + "\n";
  await appendFile(auditPath, line, "utf8");
}
