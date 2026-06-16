import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  spawn: vi.fn()
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: mocks.existsSync
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: mocks.spawn
  };
});

const PROBE_MARKER = "ESTACODA_TEST_PYTHON_OK";

type CandidateBehavior = "usable" | "hang" | "fail" | "bad-marker" | "spawn-error";

const candidateBehaviors = new Map<string, CandidateBehavior>();

class FakeChildProcess extends EventEmitter {
  readonly stdout = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn()
  });

  readonly kill = vi.fn();
}

beforeEach(() => {
  candidateBehaviors.clear();
  mocks.existsSync.mockReset();
  mocks.existsSync.mockReturnValue(true);
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation((candidate: string) => createFakeChildProcess(candidate));
});

describe("resolveUsableTestPythonBinary", () => {
  it("returns a usable candidate", async () => {
    setCandidateBehavior("usable-python", "usable");

    await expect(resolveUsableTestPythonBinary(["usable-python"], 1_000)).resolves.toBe("usable-python");
  });

  it("rejects hanging and failing candidates before returning a later usable candidate", async () => {
    setCandidateBehavior("hanging-python", "hang");
    setCandidateBehavior("failing-python", "fail");
    setCandidateBehavior("usable-python", "usable");

    await expect(
      resolveUsableTestPythonBinary(["hanging-python", "failing-python", "usable-python"], 500)
    ).resolves.toBe("usable-python");
  });

  it("rejects exit-zero candidates that do not print the Python probe marker", async () => {
    setCandidateBehavior("not-python", "bad-marker");
    setCandidateBehavior("usable-python", "usable");

    await expect(resolveUsableTestPythonBinary(["not-python", "usable-python"], 1_000)).resolves.toBe(
      "usable-python"
    );
  });

  it("rejects spawn error candidates before returning a later usable candidate", async () => {
    setCandidateBehavior("blocked-python", "spawn-error");
    setCandidateBehavior("usable-python", "usable");

    await expect(resolveUsableTestPythonBinary(["blocked-python", "usable-python"], 1_000)).resolves.toBe(
      "usable-python"
    );
  });

  it("throws a clear error when no candidate passes the probe", async () => {
    setCandidateBehavior("failing-python", "fail");

    await expect(resolveUsableTestPythonBinary(["failing-python"], 1_000)).rejects.toThrow(
      /No usable Python interpreter found for tests/
    );
  });
});

function setCandidateBehavior(candidate: string, behavior: CandidateBehavior): void {
  candidateBehaviors.set(candidate, behavior);
}

function createFakeChildProcess(candidate: string): FakeChildProcess {
  const child = new FakeChildProcess();
  const behavior = candidateBehaviors.get(candidate) ?? "spawn-error";

  queueMicrotask(() => {
    if (behavior === "usable") {
      child.stdout.emit("data", `${PROBE_MARKER}\n${candidate}\n`);
      child.emit("close", 0);
      return;
    }
    if (behavior === "fail") {
      child.emit("close", 2);
      return;
    }
    if (behavior === "bad-marker") {
      child.stdout.emit("data", `NOT_${PROBE_MARKER}\n${candidate}\n`);
      child.emit("close", 0);
      return;
    }
    if (behavior === "spawn-error") {
      child.emit("error", new Error("spawn failed"));
    }
  });

  return child;
}

const { resolveUsableTestPythonBinary } = await import("./test-python.js");
