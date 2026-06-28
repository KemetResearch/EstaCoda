import { describe, expect, it, vi } from "vitest";
import {
  createOperatorConsoleRuntimeHost,
  type SetupSurfaceState,
} from "../../ui/papyrus/operator-console/index.js";
import { createSetupOperatorConsoleController } from "./setupOperatorConsoleController.js";

const forbiddenManagedRegionOutput = /\x1b\[3J|\x1b\[2J|\x1b\[H|\x1b\[\d+;\d+H/u;

describe("SetupOperatorConsoleController", () => {
  it("renders a setup panel through a setup-mode runtime host", () => {
    const output = createOutput();
    const controller = createSetupOperatorConsoleController({
      output,
      terminal: { width: 72, height: 16, isTty: true },
    });

    const rows = controller.render(setupPanel("primary"));
    const text = stripAnsi(output.text());
    const state = controller.runtimeHost.getState();

    expect(rows).toBeGreaterThan(1);
    expect(state.mode).toBe("setup");
    expect(state.setupPanel?.kind).toBe("table");
    expect(text).toContain("Setup Editor");
    expect(text).toContain("Primary model");
    expect(text).not.toContain("ctx");
    expect(text).not.toContain("◷");
    expect(text).not.toContain("›");
    expect(output.text()).not.toMatch(/\x1b\[\d+B/u);
    expect(output.text()).not.toMatch(forbiddenManagedRegionOutput);
  });

  it("rerenders selected setup rows in the same terminal frame", () => {
    const output = createOutput();
    const controller = createSetupOperatorConsoleController({
      output,
      terminal: { width: 72, height: 16, isTty: true },
    });

    const rows = controller.render(setupPanel("primary"));
    output.clear();

    expect(controller.setSelectedRow("browser")).toBe(true);
    const text = stripAnsi(output.text());

    expect(controller.currentPanel).toMatchObject({ selectedRowId: "browser" });
    expect(output.text()).toContain(`\x1b[${rows - 1}A`);
    expect(output.text()).not.toMatch(/\x1b\[\d+B/u);
    expect(text).toContain("Browser");
    expect(text).not.toContain("Selected:");
    expect(output.text()).not.toMatch(forbiddenManagedRegionOutput);
  });

  it("ignores unknown selected row ids", () => {
    const output = createOutput();
    const controller = createSetupOperatorConsoleController({
      output,
      terminal: { width: 72, height: 16, isTty: true },
    });

    controller.render(setupPanel("primary"));
    output.clear();

    expect(controller.setSelectedRow("missing")).toBe(false);
    expect(controller.currentPanel).toMatchObject({ selectedRowId: "primary" });
    expect(output.text()).toBe("");
  });

  it("clears rendered setup frames safely", () => {
    const output = createOutput();
    const controller = createSetupOperatorConsoleController({
      output,
      terminal: { width: 72, height: 16, isTty: true },
    });

    controller.render(setupPanel("primary"));
    output.clear();
    controller.clear();

    expect(controller.currentPanel).toBeUndefined();
    expect(controller.runtimeHost.getState().mode).toBe("setup");
    expect(controller.runtimeHost.getState().setupPanel).toBeUndefined();
    expect(output.text()).toContain("\x1b[0K");
    expect(output.text()).not.toMatch(forbiddenManagedRegionOutput);
  });

  it("does not drive session prompt, status, transcript, or activity state", () => {
    const output = createOutput();
    const runtimeHost = createOperatorConsoleRuntimeHost({
      terminal: { width: 72, height: 16, isTty: true },
    });
    const setStatus = vi.spyOn(runtimeHost, "setStatus");
    const setPrompt = vi.spyOn(runtimeHost, "setPrompt");
    const setTranscript = vi.spyOn(runtimeHost, "setTranscript");
    const setTurnActivity = vi.spyOn(runtimeHost, "setTurnActivity");
    const setActiveWork = vi.spyOn(runtimeHost, "setActiveWork");
    const controller = createSetupOperatorConsoleController({
      output,
      runtimeHost,
      terminal: { width: 72, height: 16, isTty: true },
    });

    controller.render(setupPanel("primary"));

    expect(setStatus).not.toHaveBeenCalled();
    expect(setPrompt).not.toHaveBeenCalled();
    expect(setTranscript).not.toHaveBeenCalled();
    expect(setTurnActivity).not.toHaveBeenCalled();
    expect(setActiveWork).not.toHaveBeenCalled();
    expect(runtimeHost.getState().mode).toBe("setup");
    expect(runtimeHost.getState().transcript).toEqual([]);
    expect(runtimeHost.getState().prompt.value).toBe("");
  });
});

function setupPanel(selectedRowId: string): SetupSurfaceState {
  return {
    kind: "table",
    layout: "choiceMenu",
    title: "Setup Editor",
    description: "Choose what to configure:",
    rows: [
      {
        id: "primary",
        provider: "Primary model",
        model: "",
        status: "Default model used by the agent.",
        notes: "",
      },
      {
        id: "browser",
        provider: "Browser",
        model: "",
        status: "Configure browser control.",
        notes: "",
      },
      {
        id: "cancel",
        provider: "Cancel",
        model: "",
        status: "Exit without changing setup.",
        notes: "",
        group: "navigation",
      },
    ],
    selectedRowId,
    footer: "↑↓ navigate   ENTER select",
  };
}

function createOutput(): {
  readonly columns: number;
  readonly rows: number;
  readonly isTTY: boolean;
  write: (chunk: string | Uint8Array) => boolean;
  text: () => string;
  clear: () => void;
} {
  const writes: string[] = [];
  return {
    columns: 72,
    rows: 16,
    isTTY: true,
    write: (chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
    text: () => writes.join(""),
    clear: () => {
      writes.length = 0;
    },
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, "");
}
