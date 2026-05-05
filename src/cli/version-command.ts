import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export async function getPackageVersion(): Promise<string> {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const packagePath = join(dirname(modulePath), "..", "..", "package.json");
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function runVersionCommand(): Promise<{ exitCode: number; output: string }> {
  const version = await getPackageVersion();
  return {
    exitCode: 0,
    output: `estacoda ${version}`
  };
}
