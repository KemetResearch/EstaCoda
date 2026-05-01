import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { BundledManifest, BundledManifestEntry } from "../contracts/skill.js";

export type BundledSyncResult = {
  copied: number;
  updated: number;
  skipped: number;
  userModified: number;
  cleaned: number;
  totalBundled: number;
  warnings: string[];
};

export type BundledResetResult = {
  ok: boolean;
  mode: "restore" | "rebaseline";
  name: string;
  localPath?: string;
  bundledPath?: string;
  message: string;
};

type BundledSkillEntry = {
  name: string;
  bundledDir: string;
  relativePath: string;
  hash: string;
};

const MANIFEST_FILENAME = ".bundled_manifest.json";
const IGNORED_NAMES = new Set([
  ".DS_Store",
  MANIFEST_FILENAME
]);
const IGNORED_DIRS = new Set([
  ".archive",
  ".snapshots",
  ".git",
  "node_modules"
]);

export async function syncBundledSkills(options: {
  bundledSkillsDir: string;
  localSkillsRoot: string;
  now?: () => Date;
}): Promise<BundledSyncResult> {
  const now = options.now ?? (() => new Date());
  const bundledRoot = resolve(options.bundledSkillsDir);
  const localRoot = resolve(options.localSkillsRoot);
  await mkdir(localRoot, { recursive: true });

  const manifestPath = join(localRoot, MANIFEST_FILENAME);
  const manifest = await readBundledManifest(manifestPath);
  const bundledSkills = await discoverBundledSkills(bundledRoot);
  const bundledByPath = new Map(bundledSkills.map((skill) => [skill.relativePath, skill]));
  const result: BundledSyncResult = {
    copied: 0,
    updated: 0,
    skipped: 0,
    userModified: 0,
    cleaned: 0,
    totalBundled: bundledSkills.length,
    warnings: []
  };

  for (const skill of bundledSkills) {
    const localDir = containedSkillDestination(localRoot, skill.relativePath);
    const localPath = relative(localRoot, localDir);
    const existing = manifest.entries[skill.relativePath];
    const localExists = await directoryExists(localDir);

    if (existing === undefined) {
      if (localExists) {
        const localHash = await hashSkillDirectory(localDir);
        if (localHash === skill.hash) {
          manifest.entries[skill.relativePath] = manifestEntryFor({
            skill,
            localPath,
            originHash: skill.hash,
            bundledHash: skill.hash,
            now: now()
          });
          result.skipped += 1;
        } else {
          result.skipped += 1;
          result.warnings.push(`Skipped bundled skill ${skill.relativePath}; local destination already exists and differs.`);
        }
        continue;
      }

      await copySkillDirectory(skill.bundledDir, localDir);
      manifest.entries[skill.relativePath] = manifestEntryFor({
        skill,
        localPath,
        originHash: skill.hash,
        bundledHash: skill.hash,
        now: now()
      });
      result.copied += 1;
      continue;
    }

    if (!localExists) {
      result.skipped += 1;
      continue;
    }

    const localHash = await hashSkillDirectory(localDir);
    if (localHash !== existing.originHash) {
      result.userModified += 1;
      continue;
    }

    if (skill.hash === existing.bundledHash) {
      result.skipped += 1;
      continue;
    }

    const backupDir = `${localDir}.bundled-backup-${Date.now()}`;
    try {
      await cp(localDir, backupDir, { recursive: true });
      await rm(localDir, { recursive: true, force: true });
      await copySkillDirectory(skill.bundledDir, localDir);
      await rm(backupDir, { recursive: true, force: true });
      manifest.entries[skill.relativePath] = manifestEntryFor({
        skill,
        localPath,
        originHash: skill.hash,
        bundledHash: skill.hash,
        seededAt: existing.seededAt,
        now: now()
      });
      result.updated += 1;
    } catch (error) {
      await rm(localDir, { recursive: true, force: true }).catch(() => undefined);
      await rename(backupDir, localDir).catch(() => undefined);
      result.skipped += 1;
      result.warnings.push(`Failed to update bundled skill ${skill.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const bundledPath of Object.keys(manifest.entries)) {
    if (!bundledByPath.has(bundledPath)) {
      delete manifest.entries[bundledPath];
      result.cleaned += 1;
    }
  }

  await writeBundledManifest(manifestPath, manifest);
  return result;
}

export async function resetBundledSkill(options: {
  name: string;
  mode?: "restore" | "rebaseline";
  bundledSkillsDir: string;
  localSkillsRoot: string;
  now?: () => Date;
}): Promise<BundledResetResult> {
  const mode = options.mode ?? "restore";
  const now = options.now ?? (() => new Date());
  const localRoot = resolve(options.localSkillsRoot);
  const manifestPath = join(localRoot, MANIFEST_FILENAME);
  const manifest = await readBundledManifest(manifestPath);
  const bundledRoot = resolve(options.bundledSkillsDir);
  const bundledSkills = await discoverBundledSkills(bundledRoot);
  const bundledByPath = new Map(bundledSkills.map((skill) => [skill.relativePath, skill]));
  const matches = Object.entries(manifest.entries).filter(([, entry]) => entry.name === options.name);
  const match = matches[0];

  if (match === undefined) {
    return {
      ok: false,
      mode,
      name: options.name,
      message: `No bundled manifest entry found for ${options.name}.`
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      mode,
      name: options.name,
      message: [
        `Multiple bundled manifest entries share the skill name ${options.name}; reset is ambiguous.`,
        "Choose one bundled path explicitly after resolving the duplicate names:",
        ...matches.map(([, entry]) => `- ${entry.bundledPath}`)
      ].join("\n")
    };
  }

  const [manifestKey, entry] = match;
  const bundled = bundledByPath.get(entry.bundledPath);
  if (bundled === undefined) {
    return {
      ok: false,
      mode,
      name: options.name,
      localPath: entry.localPath,
      bundledPath: entry.bundledPath,
      message: `Bundled source for ${options.name} is no longer available.`
    };
  }

  const localDir = containedSkillDestination(localRoot, entry.localPath);
  if (mode === "restore") {
    await rm(localDir, { recursive: true, force: true });
    await copySkillDirectory(bundled.bundledDir, localDir);
    manifest.entries[manifestKey] = manifestEntryFor({
      skill: bundled,
      localPath: entry.localPath,
      originHash: bundled.hash,
      bundledHash: bundled.hash,
      seededAt: entry.seededAt,
      now: now()
    });
  } else {
    if (!(await directoryExists(localDir))) {
      return {
        ok: false,
        mode,
        name: options.name,
        localPath: entry.localPath,
        bundledPath: entry.bundledPath,
        message: `Local copy for ${options.name} does not exist.`
      };
    }
    manifest.entries[manifestKey] = {
      ...entry,
      originHash: await hashSkillDirectory(localDir),
      bundledHash: bundled.hash,
      lastSyncedAt: now().toISOString()
    };
  }

  await writeBundledManifest(manifestPath, manifest);
  return {
    ok: true,
    mode,
    name: options.name,
    localPath: entry.localPath,
    bundledPath: entry.bundledPath,
    message: mode === "restore"
      ? `Restored ${options.name} from bundled baseline.`
      : `Rebaselined ${options.name} to the current local copy.`
  };
}

export async function hashSkillDirectory(directory: string): Promise<string> {
  const root = resolve(directory);
  const files = await listHashableFiles(root);
  const hash = createHash("md5");

  for (const file of files) {
    const relativePath = relative(root, file);
    hash.update(relativePath, "utf8");
    hash.update(await readFile(file));
  }

  return hash.digest("hex");
}

async function discoverBundledSkills(bundledRoot: string): Promise<BundledSkillEntry[]> {
  const skills: BundledSkillEntry[] = [];
  const dirs = await findSkillDirectories(bundledRoot);

  for (const bundledDir of dirs) {
    const skillPath = join(bundledDir, "SKILL.md");
    const raw = await readFile(skillPath, "utf8").catch(() => "");
    const name = extractSkillName(raw) ?? relative(bundledRoot, bundledDir).split(/[\\/]/u).join("-");
    skills.push({
      name,
      bundledDir,
      relativePath: relative(bundledRoot, bundledDir),
      hash: await hashSkillDirectory(bundledDir)
    });
  }

  return skills.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function findSkillDirectories(root: string): Promise<string[]> {
  const found: string[] = [];
  await walk(root);
  return found;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      found.push(directory);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldIgnoreName(entry.name)) {
        continue;
      }
      await walk(join(directory, entry.name));
    }
  }
}

async function listHashableFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root);
  return files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (shouldIgnoreName(entry.name)) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
}

function manifestEntryFor(input: {
  skill: BundledSkillEntry;
  localPath: string;
  originHash: string;
  bundledHash: string;
  seededAt?: string;
  now: Date;
}): BundledManifestEntry {
  return {
    name: input.skill.name,
    bundledPath: input.skill.relativePath,
    localPath: input.localPath,
    originHash: input.originHash,
    bundledHash: input.bundledHash,
    seededAt: input.seededAt ?? input.now.toISOString(),
    lastSyncedAt: input.now.toISOString()
  };
}

async function copySkillDirectory(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

function containedSkillDestination(localRoot: string, relativePath: string): string {
  const destination = resolve(localRoot, relativePath);
  const relativeToRoot = relative(localRoot, destination);
  if (relativeToRoot.startsWith("..") || relativeToRoot === "" || relativeToRoot.includes(`..${"/"}`)) {
    throw new Error(`Bundled skill destination escapes local root: ${relativePath}`);
  }
  return destination;
}

async function readBundledManifest(path: string): Promise<BundledManifest> {
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (raw === undefined) {
    return { version: 1, entries: {} };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BundledManifest>;
    return {
      version: 1,
      entries: isRecord(parsed.entries) ? parsed.entries as Record<string, BundledManifestEntry> : {}
    };
  } catch {
    return { version: 1, entries: {} };
  }
}

async function writeBundledManifest(path: string, manifest: BundledManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

async function directoryExists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() === true;
}

function shouldIgnoreName(name: string): boolean {
  return IGNORED_NAMES.has(name) ||
    IGNORED_DIRS.has(name) ||
    name.endsWith("~") ||
    name.endsWith(".tmp") ||
    name.includes(".bundled-backup-");
}

function extractSkillName(content: string): string | undefined {
  const jsonFrontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/u)?.[1];
  if (jsonFrontmatter !== undefined) {
    try {
      const parsed = JSON.parse(jsonFrontmatter) as unknown;
      if (isRecord(parsed) && typeof parsed.name === "string" && parsed.name.trim().length > 0) {
        return parsed.name.trim();
      }
    } catch {
      // Fall through to lightweight YAML-style name extraction.
    }
    const yamlName = jsonFrontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim();
    if (yamlName !== undefined && yamlName.length > 0) {
      return yamlName;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
