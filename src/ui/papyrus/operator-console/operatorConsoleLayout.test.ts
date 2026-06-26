import { describe, expect, it } from "vitest";
import {
  createDefaultToolActivityState,
  createInitialOperatorConsoleState,
  createOperatorConsoleLayout,
  type OperatorConsoleLayout,
  type OperatorConsoleRegion,
  type OperatorConsoleState,
} from "./index.js";

describe("Papyrus operator console layout", () => {
  it("includes prompt and status rail regions for minimal state", () => {
    const layout = createOperatorConsoleLayout(createState(), { width: 80, height: 10, isTty: true });

    expect(regionKinds(layout)).toEqual(["prompt", "statusRail"]);
    expect(region(layout, "prompt")?.visible).toBe(true);
    expect(region(layout, "statusRail")?.visible).toBe(true);
  });

  it("orders present regions by the canonical vertical surface order", () => {
    const layout = createOperatorConsoleLayout(createFullState(), { width: 80, height: 24, isTty: true });

    expect(regionKinds(layout)).toEqual([
      "transcript",
      "activeWork",
      "queuedSteer",
      "attachments",
      "prompt",
      "slashMenu",
      "statusRail",
    ]);
    expect(layout.regions.map((item) => item.y)).toEqual([...layout.regions.map((item) => item.y)].sort((a, b) => a - b));
  });

  it("includes active work only when active work state is non-empty", () => {
    expect(regionKinds(createOperatorConsoleLayout(createState()))).not.toContain("activeWork");

    const layout = createOperatorConsoleLayout(createState({
      activeWork: {
        items: [toolItem("tool-1", "running")],
        scrollOffset: 0,
        expanded: true,
      },
    }));
    expect(regionKinds(layout)).toContain("activeWork");
  });

  it("includes queued steer only when queued steer state exists", () => {
    expect(regionKinds(createOperatorConsoleLayout(createState()))).not.toContain("queuedSteer");

    const layout = createOperatorConsoleLayout(createState({
      steer: {
        draft: "",
        cursorOffset: 0,
        queued: { text: "focus on approvals" },
      },
    }));
    expect(regionKinds(layout)).toContain("queuedSteer");
  });

  it("includes attachments only when attachments exist", () => {
    expect(regionKinds(createOperatorConsoleLayout(createState()))).not.toContain("attachments");

    const layout = createOperatorConsoleLayout(createState({
      attachments: [pastedAttachment("paste-1")],
    }));
    expect(regionKinds(layout)).toContain("attachments");
  });

  it("includes slash menu only when slash state exists", () => {
    expect(regionKinds(createOperatorConsoleLayout(createState()))).not.toContain("slashMenu");

    const layout = createOperatorConsoleLayout(createState({
      slash: {
        query: "/mo",
        items: [{ id: "model", label: "/model" }],
      },
    }));
    expect(regionKinds(layout)).toContain("slashMenu");
  });

  it("keeps prompt and status rail allocated under constrained height", () => {
    const layout = createOperatorConsoleLayout(createFullState(), { width: 60, height: 2, isTty: true });

    expect(region(layout, "prompt")).toMatchObject({ height: 1, visible: true });
    expect(region(layout, "statusRail")).toMatchObject({ height: 1, visible: true });
  });

  it("allocates prompt height from prompt surface content within terminal constraints", () => {
    const layout = createOperatorConsoleLayout(createState({
      prompt: {
        value: [
          "write a migration plan for:",
          "- approval cards",
          "- pasted attachments",
          "- tool activity",
        ].join("\n"),
        cursorOffset: 0,
        multiline: true,
        scrollOffset: 0,
        mode: "prompt",
      },
    }), { width: 80, height: 20, isTty: true });

    expect(region(layout, "prompt")?.height).toBe(6);
  });

  it("caps multiline prompt allocation at 8 input rows plus border", () => {
    const value = numberedLines(14);
    const layout = createOperatorConsoleLayout(createState({
      prompt: {
        value,
        cursorOffset: value.length,
        multiline: true,
        scrollOffset: 0,
        mode: "prompt",
      },
    }), { width: 80, height: 80, isTty: true });

    expect(region(layout, "prompt")?.height).toBe(10);
  });

  it("caps multiline prompt allocation at 30 percent of terminal height when constrained", () => {
    const value = numberedLines(14);
    const layout = createOperatorConsoleLayout(createState({
      prompt: {
        value,
        cursorOffset: value.length,
        multiline: true,
        scrollOffset: 0,
        mode: "prompt",
      },
    }), { width: 80, height: 20, isTty: true });

    expect(region(layout, "prompt")?.height).toBe(6);
  });

  it("hides optional regions before prompt and status rail under constrained height", () => {
    const layout = createOperatorConsoleLayout(createFullState(), { width: 60, height: 2, isTty: true });

    expect(visibleRegionKinds(layout)).toEqual(["prompt", "statusRail"]);
    expect(region(layout, "activeWork")).toMatchObject({ height: 0, visible: false });
    expect(region(layout, "attachments")).toMatchObject({ height: 0, visible: false });
    expect(region(layout, "transcript")).toMatchObject({ height: 0, visible: false });
  });

  it("keeps region bounds inside the terminal rectangle", () => {
    const layout = createOperatorConsoleLayout(createFullState(), { width: 32, height: 8, isTty: true });

    for (const item of layout.regions) {
      expect(item.x).toBe(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.width).toBeLessThanOrEqual(layout.width);
      expect(item.height).toBeGreaterThanOrEqual(0);
      expect(item.y + item.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("is pure and deterministic", () => {
    const state = createFullState();
    const before = JSON.stringify(state);
    const terminal = { width: 80, height: 12, isTty: true };

    expect(createOperatorConsoleLayout(state, terminal)).toEqual(createOperatorConsoleLayout(state, terminal));
    expect(JSON.stringify(state)).toBe(before);
  });
});

function createState(input: Partial<OperatorConsoleState> = {}): OperatorConsoleState {
  return createInitialOperatorConsoleState({
    activeWork: createDefaultToolActivityState(),
    terminal: { width: 80, height: 24, isTty: true },
    ...input,
  });
}

function createFullState(): OperatorConsoleState {
  return createState({
    transcript: [{ id: "t1", role: "assistant", text: "Ready." }],
    activeWork: {
      items: [toolItem("tool-1", "running")],
      scrollOffset: 0,
      expanded: true,
    },
    steer: {
      draft: "",
      cursorOffset: 0,
      queued: { text: "focus on approvals" },
    },
    attachments: [pastedAttachment("paste-1")],
    slash: {
      query: "/mo",
      items: [{ id: "model", label: "/model" }],
    },
  });
}

function regionKinds(layout: OperatorConsoleLayout): readonly OperatorConsoleRegion["kind"][] {
  return layout.regions.map((item) => item.kind);
}

function visibleRegionKinds(layout: OperatorConsoleLayout): readonly OperatorConsoleRegion["kind"][] {
  return layout.regions.filter((item) => item.visible).map((item) => item.kind);
}

function region(layout: OperatorConsoleLayout, kind: OperatorConsoleRegion["kind"]): OperatorConsoleRegion | undefined {
  return layout.regions.find((item) => item.kind === kind);
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

function pastedAttachment(id: string) {
  return {
    id,
    kind: "pastedText" as const,
    title: "pasted text",
    preview: "MVP known issue",
    content: "MVP known issue details",
    metadata: { chars: 2_481 },
  };
}

function toolItem(id: string, status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "awaitingApproval") {
  return {
    id,
    toolName: "read_file",
    status,
    summary: "src/cli/session-loop.ts",
    target: "src/cli/session-loop.ts",
    durationMs: 1_000,
  };
}
