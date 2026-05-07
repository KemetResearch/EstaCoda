import { mkdir } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackForceAuditRecord } from "../contracts/pack.js";

export type PackForceAuditLogOptions = {
  homeDir: string;
};

export async function writePackForceAuditRecord(options: PackForceAuditLogOptions, record: PackForceAuditRecord): Promise<void> {
  const auditDir = join(options.homeDir, ".estacoda", "packs", "audit");
  const auditPath = join(auditDir, "force-overrides.jsonl");

  await mkdir(auditDir, { recursive: true });

  const line = JSON.stringify(record) + "\n";
  await appendFile(auditPath, line, "utf8");
}
