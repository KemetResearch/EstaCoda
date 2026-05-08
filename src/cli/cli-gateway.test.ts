import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCliCommand } from "./cli.js";
import * as supervisorModule from "../gateway/supervisor.js";

describe("cli gateway start", () => {
  let supervisorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    supervisorSpy = vi.spyOn(supervisorModule, "runGatewaySupervisor").mockResolvedValue({
      ok: true,
      output: "Gateway started",
      polls: 0,
      processed: 0,
    });
  });

  afterEach(() => {
    supervisorSpy.mockRestore();
  });
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
    expect(result.output).toContain("estacoda gateway restart");
    expect(result.output).toContain("estacoda gateway restart --graceful");
  });

  it("parses gateway restart subcommand", async () => {
    const result = await runCliCommand({
      argv: ["gateway", "restart"],
      workspaceRoot: "/tmp",
    });
    expect(result.handled).toBe(true);
    // Will fail to start due to no config, but command is handled
    expect(result.output).toContain("Gateway was not running");
  });

  it("parses gateway restart --graceful", async () => {
    const result = await runCliCommand({
      argv: ["gateway", "restart", "--graceful"],
      workspaceRoot: "/tmp",
    });
    expect(result.handled).toBe(true);
    expect(result.output).toContain("Gateway was not running");
  });
});
