import { describe, expect, it } from "vitest";
import {
  classifyBrowserUrl,
  type BrowserUrlClassification,
  type HybridClassificationResult
} from "./hybrid-classifier.js";
import type { ResolveHostnameFn } from "./url-safety.js";

async function classify(
  url: string,
  addresses: string[] = ["93.184.216.34"]
): Promise<HybridClassificationResult> {
  const resolver: ResolveHostnameFn = async () => addresses;
  return await classifyBrowserUrl(url, { resolveHostname: resolver });
}

async function expectClassification(
  url: string,
  classification: BrowserUrlClassification,
  addresses?: string[]
): Promise<HybridClassificationResult> {
  const result = await classify(url, addresses);
  expect(result.classification).toBe(classification);
  expect(result.reason.length).toBeGreaterThan(0);
  return result;
}

describe("classifyBrowserUrl", () => {
  it("classifies public HTTPS URLs as public", async () => {
    const result = await expectClassification("https://example.com", "public");
    expect(result.hostname).toBe("example.com");
    expect(result.resolvedAddresses).toEqual(["93.184.216.34"]);
  });

  it("classifies public HTTP URLs as public", async () => {
    await expectClassification("http://example.com", "public");
  });

  it("classifies malformed URLs as invalid", async () => {
    const result = await classifyBrowserUrl("not a url");
    expect(result.classification).toBe("invalid");
    expect(result.reason).toMatch(/HTTP or HTTPS URL/);
  });

  it("classifies non-HTTP schemes as invalid", async () => {
    const result = await classifyBrowserUrl("file:///etc/passwd");
    expect(result.classification).toBe("invalid");
    expect(result.reason).toMatch(/HTTP or HTTPS URL/);
  });

  it("classifies localhost hostnames as private or internal without DNS", async () => {
    const calls: string[] = [];
    const result = await classifyBrowserUrl("http://localhost", {
      resolveHostname: async (hostname) => {
        calls.push(hostname);
        return ["93.184.216.34"];
      }
    });
    expect(result.classification).toBe("private-or-internal");
    expect(calls).toEqual([]);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.10.20"
  ])("classifies private/internal IPv4 literal %s as private or internal", async (address) => {
    await expectClassification(`http://${address}`, "private-or-internal");
  });

  it("classifies IPv4 metadata endpoints as always blocked", async () => {
    const result = await expectClassification("http://169.254.169.254", "always-blocked");
    expect(result.reason).toMatch(/metadata endpoint/);
  });

  it("classifies common cloud metadata hostnames as always blocked", async () => {
    const result = await expectClassification("http://metadata.google.internal", "always-blocked");
    expect(result.hostname).toBe("metadata.google.internal");
  });

  it.each([
    "[::1]",
    "[fd00::1]",
    "[fe80::1]"
  ])("classifies IPv6 private/internal literal %s as private or internal", async (address) => {
    await expectClassification(`http://${address}`, "private-or-internal");
  });

  it("classifies resolver-controlled public hostnames as public", async () => {
    await expectClassification("https://public.example", "public", ["93.184.216.34"]);
  });

  it("classifies hostnames resolving to private addresses as private or internal", async () => {
    const result = await expectClassification("https://example.com", "private-or-internal", ["10.0.0.5"]);
    expect(result.resolvedAddresses).toEqual(["10.0.0.5"]);
  });

  it("classifies hostnames resolving to metadata addresses as always blocked", async () => {
    await expectClassification("https://example.com", "always-blocked", ["169.254.169.254"]);
  });

  it("classifies mixed public/private resolver results as private or internal", async () => {
    await expectClassification("https://example.com", "private-or-internal", ["93.184.216.34", "192.168.1.10"]);
  });

  it("classifies mixed public/metadata resolver results as always blocked", async () => {
    await expectClassification("https://example.com", "always-blocked", ["93.184.216.34", "169.254.169.254"]);
  });

  it("fails closed with deterministic output when hostname resolution throws", async () => {
    const result = await classifyBrowserUrl("https://example.com", {
      resolveHostname: async () => {
        throw new Error("dns down");
      }
    });
    expect(result).toMatchObject({
      classification: "private-or-internal",
      hostname: "example.com"
    });
    expect(result.reason).toMatch(/resolution failed/);
  });

  it("fails closed when hostname resolution returns no addresses", async () => {
    const result = await expectClassification("https://example.com", "private-or-internal", []);
    expect(result.reason).toMatch(/no addresses/);
  });

  it("does not depend on real DNS for deterministic resolver-controlled results", async () => {
    const calls: string[] = [];
    const result = await classifyBrowserUrl("https://example.com", {
      resolveHostname: (hostname) => {
        calls.push(hostname);
        return ["93.184.216.34"];
      }
    });

    expect(result.classification).toBe("public");
    expect(calls).toEqual(["example.com"]);
  });
});
