import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCronContextSources } from "./cron-context.js";
import { CronStore } from "./cron-store.js";

describe("loadCronContextSources", () => {
  let tmpDir: string;
  let store: CronStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "estacoda-cron-context-test-"));
    store = new CronStore({
      homeDir: tmpDir,
      outputRoot: join(tmpDir, "cron-output")
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads the latest output for a valid job id", async () => {
    await store.writeOutput("cron-safe", new Date("2030-01-01T00:00:00Z"), "older");
    await store.writeOutput("cron-safe", new Date("2030-01-01T00:01:00Z"), "latest");

    const sources = await loadCronContextSources({ store, jobIds: ["cron-safe"] });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      jobId: "cron-safe",
      output: expect.stringContaining("latest")
    });
    expect(sources[0]?.outputPath?.startsWith(resolve(store.outputRoot))).toBe(true);
  });

  it("skips malformed job ids without reading outside the output root", async () => {
    const outsideDir = join(tmpDir, "outside");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "2030-01-01T00-00-00-000Z.md"), "outside secret", "utf8");

    const sources = await loadCronContextSources({
      store,
      jobIds: ["../outside", "nested/id", resolve(outsideDir)]
    });

    expect(sources).toEqual([
      { jobId: "../outside", skippedReason: "unsafe job id" },
      { jobId: "nested/id", skippedReason: "unsafe job id" },
      { jobId: resolve(outsideDir), skippedReason: "unsafe job id" }
    ]);
    expect(sources.map((source) => source.output).join("\n")).not.toContain("outside secret");
  });
});
