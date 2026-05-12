import { describe, it, expect } from "vitest";
import { buildSafeChildEnv } from "./process-env.js";

describe("buildSafeChildEnv", () => {
  it("does not inherit parent secrets", () => {
    const env = buildSafeChildEnv();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("isolates HOME and ignores extra.HOME", () => {
    const env = buildSafeChildEnv({ extra: { HOME: "/real/home" } });
    expect(env.HOME).not.toBe("/real/home");
    expect(env.HOME).toContain("estacoda");
  });

  it("ignores extra.PATH and preserves parent PATH", () => {
    const originalPath = process.env.PATH;
    const env = buildSafeChildEnv({ extra: { PATH: "/malicious/bin" } });
    if (originalPath !== undefined) {
      expect(env.PATH).toBe(originalPath);
    } else {
      expect(env.PATH).toBeUndefined();
    }
    expect(env.PATH).not.toBe("/malicious/bin");
  });

  it("ignores extra.TMPDIR, extra.TMP, extra.TEMP when parent has them", () => {
    const env = buildSafeChildEnv({ extra: { TMPDIR: "/evil", TMP: "/evil", TEMP: "/evil" } });
    if (process.env.TMPDIR) {
      expect(env.TMPDIR).toBe(process.env.TMPDIR);
    } else if (process.env.TMP) {
      expect(env.TMP).toBe(process.env.TMP);
    } else if (process.env.TEMP) {
      expect(env.TEMP).toBe(process.env.TEMP);
    } else {
      // Fallback path: TMPDIR should be set, not /evil
      expect(env.TMPDIR).toBeDefined();
      expect(env.TMPDIR).not.toBe("/evil");
    }
  });

  it("provides temp fallback when parent has no temp env", () => {
    const saved = {
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP
    };
    delete process.env.TMPDIR;
    delete process.env.TMP;
    delete process.env.TEMP;
    try {
      const env = buildSafeChildEnv();
      expect(env.TMPDIR).toBeDefined();
      expect(env.TMPDIR!.length).toBeGreaterThan(0);
    } finally {
      if (saved.TMPDIR !== undefined) process.env.TMPDIR = saved.TMPDIR;
      else delete process.env.TMPDIR;
      if (saved.TMP !== undefined) process.env.TMP = saved.TMP;
      else delete process.env.TMP;
      if (saved.TEMP !== undefined) process.env.TEMP = saved.TEMP;
      else delete process.env.TEMP;
    }
  });

  it("blocks reserved keys from extra (MCP-style server config)", () => {
    const env = buildSafeChildEnv({
      extra: {
        HOME: "/root",
        PATH: "/usr/local/bin",
        TMPDIR: "/tmp",
        ESTACODA_INPUT_JSON: '{"attack":true}',
        ESTACODA_ALLOWED_TOOLS_JSON: '["dangerous"]'
      }
    });
    expect(env.HOME).not.toBe("/root");
    expect(env.ESTACODA_INPUT_JSON).toBeUndefined();
    expect(env.ESTACODA_ALLOWED_TOOLS_JSON).toBeUndefined();
  });

  it("allows non-reserved extra keys", () => {
    const env = buildSafeChildEnv({ extra: { CUSTOM_VAR: "allowed" } });
    expect(env.CUSTOM_VAR).toBe("allowed");
  });
});
