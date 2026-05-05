import { describe, it, expect } from "vitest";
import { getPackageVersion, runVersionCommand } from "./version-command.js";

describe("getPackageVersion", () => {
  it("returns a semver-like string", async () => {
    const version = await getPackageVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("runVersionCommand", () => {
  it("outputs estacoda plus version", async () => {
    const result = await runVersionCommand();
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/^estacoda \d+\.\d+\.\d+/);
  });
});
