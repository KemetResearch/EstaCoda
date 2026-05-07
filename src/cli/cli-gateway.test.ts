import { describe, it, expect } from "vitest";
import { runCliCommand } from "./cli.js";

describe("cli gateway start", () => {
  it("rejects --telegram with deprecation error", async () => {
    const result = await runCliCommand({
      argv: ["gateway", "start", "--telegram"],
      workspaceRoot: "/tmp",
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("deprecated");
    expect(result.output).toContain("estacoda gateway start");
  });

  it("rejects --discord with deprecation error", async () => {
    const result = await runCliCommand({
      argv: ["gateway", "start", "--discord"],
      workspaceRoot: "/tmp",
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("deprecated");
  });

  it("rejects --email with deprecation error", async () => {
    const result = await runCliCommand({
      argv: ["gateway", "start", "--email"],
      workspaceRoot: "/tmp",
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("deprecated");
  });

  it("rejects --whatsapp with deprecation error", async () => {
    const result = await runCliCommand({
      argv: ["gateway", "start", "--whatsapp"],
      workspaceRoot: "/tmp",
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("deprecated");
  });

  it("shows updated help text without per-channel flags", async () => {
    const result = await runCliCommand({
      argv: ["gateway"],
      workspaceRoot: "/tmp",
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("estacoda gateway start");
    expect(result.output).not.toContain("--telegram");
  });
});
