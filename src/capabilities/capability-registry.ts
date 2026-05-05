import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { CapabilityManifest, CapabilityStatus, InstalledCapability } from "../contracts/capability.js";
import { validateCapabilityManifest } from "./capability-validator.js";

export type CapabilityRegistryOptions = {
  homeDir: string;
};

export class CapabilityRegistry {
  readonly #path: string;

  constructor(options: CapabilityRegistryOptions) {
    this.#path = join(options.homeDir, ".estacoda", "capabilities", "registry.jsonl");
  }

  async install(manifest: CapabilityManifest, actor: string): Promise<{ ok: true; entry: InstalledCapability } | { ok: false; errors: string[] }> {
    const validation = validateCapabilityManifest(manifest);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    const entries = await this.#readEntries();

    if (entries.some((e) => e.manifest.id === manifest.id)) {
      return { ok: false, errors: [`Capability "${manifest.id}" is already installed`] };
    }

    const status = this.#defaultStatus(manifest);
    const entry: InstalledCapability = {
      manifest,
      status,
      installedAt: new Date().toISOString(),
      installedBy: actor
    };

    entries.push(entry);
    await this.#writeEntries(entries);

    return { ok: true, entry };
  }

  async list(): Promise<InstalledCapability[]> {
    return this.#readEntries();
  }

  async find(id: string): Promise<InstalledCapability | undefined> {
    const entries = await this.#readEntries();
    return entries.find((e) => e.manifest.id === id);
  }

  async updateStatus(id: string, status: CapabilityStatus): Promise<boolean> {
    const entries = await this.#readEntries();
    const entry = entries.find((e) => e.manifest.id === id);
    if (entry === undefined) {
      return false;
    }
    entry.status = status;
    await this.#writeEntries(entries);
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const entries = await this.#readEntries();
    const filtered = entries.filter((e) => e.manifest.id !== id);
    if (filtered.length === entries.length) {
      return false;
    }
    await this.#writeEntries(filtered);
    return true;
  }

  async getErrors(): Promise<Array<{ id: string; errors: string[] }>> {
    const entries = await this.#readEntries();
    const result: Array<{ id: string; errors: string[] }> = [];

    for (const entry of entries) {
      if (entry.status === "error") {
        result.push({ id: entry.manifest.id, errors: ["Status is error"] });
        continue;
      }
      const validation = validateCapabilityManifest(entry.manifest);
      if (!validation.ok) {
        result.push({ id: entry.manifest.id, errors: validation.errors });
      }
    }

    return result;
  }

  #defaultStatus(manifest: CapabilityManifest): CapabilityStatus {
    if (manifest.provenance.origin === "external") {
      return "disabled";
    }
    return "enabled";
  }

  async #readEntries(): Promise<InstalledCapability[]> {
    if (!existsSync(this.#path)) {
      return [];
    }

    const text = await readFile(this.#path, "utf8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    const entries: InstalledCapability[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]) as InstalledCapability;
        entries.push(parsed);
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`Skipping malformed registry line ${i + 1} in ${this.#path}`);
      }
    }

    return entries;
  }

  async #writeEntries(entries: InstalledCapability[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const text = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
    const tempPath = `${this.#path}.tmp`;
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, this.#path);
  }
}
