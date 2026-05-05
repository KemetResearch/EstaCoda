import { describe, it, expect } from "vitest";
import {
  getLocalVersion,
  resolveLatestVersion,
  compareVersions
} from "./version-resolver.js";

describe("getLocalVersion", () => {
  it("returns a semver string", async () => {
    const version = await getLocalVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("resolveLatestVersion", () => {
  it("handles network failure gracefully", async () => {
    const badFetch = () => Promise.reject(new Error("network down"));
    const result = await resolveLatestVersion(badFetch as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network down");
    }
  });

  it("handles non-ok HTTP response", async () => {
    const mockFetch = () =>
      Promise.resolve({
        ok: false,
        status: 404
      } as Response);

    const result = await resolveLatestVersion(mockFetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("404");
    }
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns negative when left < right", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
  });

  it("returns positive when left > right", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });
});
