import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkWebsiteAccess,
  loadWebsiteBlocklist,
  resetWebsiteBlocklistCache
} from "./website-policy.js";

describe("website policy", () => {
  it("keeps missing config disabled", () => {
    const policy = loadWebsiteBlocklist({});
    expect(policy.enabled).toBe(false);
    expect(checkWebsiteAccess("https://example.com", policy)).toEqual({ allowed: true });
  });

  it("loads config domains", () => {
    resetWebsiteBlocklistCache();
    const policy = loadWebsiteBlocklist({ domains: ["example.com", "*.blocked.test"] });
    expect(policy.enabled).toBe(true);
    expect(policy.exactDomains.has("example.com")).toBe(true);
    expect(policy.wildcardDomains.has("blocked.test")).toBe(true);
  });

  it("loads shared file rules and records missing file warnings", async () => {
    resetWebsiteBlocklistCache();
    const dir = await mkdtemp(join(tmpdir(), "estacoda-policy-test-"));
    const file = join(dir, "blocklist.txt");
    await writeFile(file, "\n# comment\nexample.com\n*.blocked.test\n");

    const policy = loadWebsiteBlocklist({
      sharedFiles: [file, join(dir, "missing.txt")]
    });

    expect(policy.exactDomains.has("example.com")).toBe(true);
    expect(policy.wildcardDomains.has("blocked.test")).toBe(true);
    expect(policy.warnings).toEqual([`Missing website blocklist file: ${join(dir, "missing.txt")}`]);
  });

  it("reuses cached policies until reset", async () => {
    resetWebsiteBlocklistCache();
    const dir = await mkdtemp(join(tmpdir(), "estacoda-policy-test-"));
    const file = join(dir, "blocklist.txt");
    await writeFile(file, "first.test\n");

    const first = loadWebsiteBlocklist({ sharedFiles: [file] });
    await writeFile(file, "second.test\n");
    const cached = loadWebsiteBlocklist({ sharedFiles: [file] });

    expect(cached).toBe(first);
    expect(cached.exactDomains.has("first.test")).toBe(true);
    expect(cached.exactDomains.has("second.test")).toBe(false);
  });

  it("loads fresh policy after cache reset", async () => {
    resetWebsiteBlocklistCache();
    const dir = await mkdtemp(join(tmpdir(), "estacoda-policy-test-"));
    const file = join(dir, "blocklist.txt");
    await writeFile(file, "first.test\n");
    loadWebsiteBlocklist({ sharedFiles: [file] });

    await writeFile(file, "second.test\n");
    resetWebsiteBlocklistCache();
    const policy = loadWebsiteBlocklist({ sharedFiles: [file] });

    expect(policy.exactDomains.has("first.test")).toBe(false);
    expect(policy.exactDomains.has("second.test")).toBe(true);
  });

  it("blocks exact domains and www-normalized domains", () => {
    resetWebsiteBlocklistCache();
    const policy = loadWebsiteBlocklist({ domains: ["example.com"] });

    expect(checkWebsiteAccess("https://example.com/page", policy)).toMatchObject({
      allowed: false,
      host: "example.com",
      matchedRule: "example.com"
    });
    expect(checkWebsiteAccess("https://www.example.com/page", policy)).toMatchObject({
      allowed: false,
      host: "example.com",
      matchedRule: "example.com"
    });
  });

  it("blocks wildcard subdomains without blocking the parent domain", () => {
    resetWebsiteBlocklistCache();
    const policy = loadWebsiteBlocklist({ domains: ["*.example.com"] });

    expect(checkWebsiteAccess("https://child.example.com", policy)).toMatchObject({
      allowed: false,
      host: "child.example.com",
      matchedRule: "*.example.com"
    });
    expect(checkWebsiteAccess("https://example.com", policy)).toEqual({
      allowed: true,
      host: "example.com"
    });
  });

  it("allows mismatches", () => {
    resetWebsiteBlocklistCache();
    const policy = loadWebsiteBlocklist({ domains: ["example.com", "*.blocked.test"] });

    expect(checkWebsiteAccess("https://allowed.test", policy)).toEqual({
      allowed: true,
      host: "allowed.test"
    });
  });

  it("fails open on malformed URLs and policy rules", () => {
    resetWebsiteBlocklistCache();
    const policy = loadWebsiteBlocklist({ domains: ["http://[bad"] });
    const enabledPolicy = loadWebsiteBlocklist({ domains: ["example.com"] });
    const malformedPolicy = loadWebsiteBlocklist({ domains: "example.com" as never });

    expect(policy.enabled).toBe(false);
    expect(malformedPolicy.enabled).toBe(false);
    expect(checkWebsiteAccess("http://[bad", policy)).toEqual({ allowed: true });
    expect(checkWebsiteAccess("http://[bad", enabledPolicy)).toBeNull();
  });
});
