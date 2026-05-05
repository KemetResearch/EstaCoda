import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkForUpdate,
  canApplyUpdate,
  prepareUpdateInfo
} from "./update-engine.js";

describe("checkForUpdate", () => {
  it("reports up-to-date when versions match", async () => {
    const mockFetch = () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v0.0.5",
            html_url: "https://example.com"
          })
      } as Response);

    const result = await checkForUpdate(mockFetch);
    expect(result.kind).toBe("up-to-date");
  });

  it("handles network errors gracefully", async () => {
    const mockFetch = () => Promise.reject(new Error("timeout"));
    const result = await checkForUpdate(mockFetch);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("timeout");
    }
  });
});

describe("canApplyUpdate", () => {
  it("rejects when ESTACODA_UPDATE_ARTIFACT is not set", () => {
    delete process.env.ESTACODA_UPDATE_ARTIFACT;
    const result = canApplyUpdate();
    expect(result.testable).toBe(false);
    expect(result.reason).toContain("not set");
  });

  it("rejects when artifact path does not exist", () => {
    process.env.ESTACODA_UPDATE_ARTIFACT = "/nonexistent/path/estacoda";
    const result = canApplyUpdate();
    expect(result.testable).toBe(false);
    expect(result.reason).toContain("does not exist");
  });

  it("accepts when artifact path exists", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "estacoda-update-test-"));
    const artifact = join(tempDir, "estacoda");
    writeFileSync(artifact, "binary", "utf8");

    process.env.ESTACODA_UPDATE_ARTIFACT = artifact;
    const result = canApplyUpdate();
    expect(result.testable).toBe(true);
  });
});

describe("prepareUpdateInfo", () => {
  it("includes current, latest, and protected paths", () => {
    const text = prepareUpdateInfo({
      current: "0.1.0",
      latest: "0.2.0",
      releaseNotesUrl: "https://example.com",
      breakingChanges: false
    });
    expect(text).toContain("0.1.0");
    expect(text).toContain("0.2.0");
    expect(text).toContain("Protected state paths");
  });

  it("warns about breaking changes", () => {
    const text = prepareUpdateInfo({
      current: "0.1.0",
      latest: "0.2.0",
      releaseNotesUrl: "https://example.com",
      breakingChanges: true
    });
    expect(text).toContain("breaking changes");
  });
});
