import { mkdir } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForceAuditRecord } from "../contracts/capability.js";

export type ForceAuditLogOptions = {
  homeDir: string;
};

export async function writeForceAuditRecord(options: ForceAuditLogOptions, record: ForceAuditRecord): Promise<void> {
  const auditDir = join(options.homeDir, ".estacoda", "capabilities", "audit");
  const auditPath = join(auditDir, "force-overrides.jsonl");

  await mkdir(auditDir, { recursive: true });

  const line = JSON.stringify(record) + "\n";
  await appendFile(auditPath, line, "utf8");
}
