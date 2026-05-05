import { describe, it, expect } from "vitest";
import { resolveTokens } from "../../theme/token-resolver.js";
import type { TerminalCapabilities } from "../../contracts/ui.js";
import {
  buildActivityTimelineViewModel,
  buildApprovalSecurityViewModel,
  buildCommandResultViewModel,
  buildKeyValueBlockViewModel,
  buildListViewModel,
  buildPickerViewModel,
  buildPlainFallbackViewModel,
  buildProgressContextRailViewModel,
  buildStartupViewModel,
  buildStatusViewModel,
  buildTableViewModel,
  buildWarningErrorViewModel,
  kv,
  listItem,
  timelineEvent,
  progressStep,
  pickerOption,
  approvalAction,
} from "../view-models/builders.js";
import { StandardRenderer } from "./standard-renderer.js";

function fullCaps(): TerminalCapabilities {
  return {
    isTTY: true,
    supportsColor: true,
    supportsTrueColor: true,
    supportsUnicode: true,
    supportsEmoji: true,
    terminalWidth: 120,
    isDumb: false,
    isCI: false,
    supportsAnimation: true,
  };
}

function noColorCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    supportsColor: false,
    supportsTrueColor: false,
  };
}

function noUnicodeCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    supportsUnicode: false,
    supportsEmoji: false,
  };
}

function plainCaps(): TerminalCapabilities {
  return {
    isTTY: false,
    supportsColor: false,
    supportsTrueColor: false,
    supportsUnicode: false,
    supportsEmoji: false,
    terminalWidth: 80,
    isDumb: true,
    isCI: false,
    supportsAnimation: false,
  };
}

function narrowCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    terminalWidth: 40,
  };
}

function renderer(theme: "light" | "dark", caps: TerminalCapabilities) {
  const tokens = resolveTokens("standard", theme, "kemetBlue");
  return new StandardRenderer({ tokens, capabilities: caps });
}

function assertNoAnsi(text: string): void {
  expect(text).not.toMatch(/\x1b\[/);
}

function hasAnsi(text: string): boolean {
  return /\x1b\[/.test(text);
}

describe("StandardRenderer — dispatch", () => {
  it("renders all ViewModel kinds without throwing", () => {
    const r = renderer("dark", fullCaps());
    const vms = [
      buildStatusViewModel({
        agentName: "A",
        model: { provider: "p", id: "i" },
        securityMode: "open",
        skillCount: 1,
        toolCount: 1,
        mcpActive: 0,
        mcpTotal: 0,
        taskflowActive: false,
      }),
      buildTableViewModel({ columns: [], rows: [] }),
      buildKeyValueBlockViewModel({ entries: [] }),
      buildListViewModel({ items: [] }),
      buildWarningErrorViewModel({ severity: "info", title: "T", message: "M" }),
      buildApprovalSecurityViewModel({
        toolName: "t",
        targetSummary: "s",
        severity: "warn",
        actions: [],
      }),
      buildActivityTimelineViewModel({ events: [] }),
      buildProgressContextRailViewModel({ steps: [] }),
      buildPickerViewModel({ title: "T", options: [] }),
      buildStartupViewModel({
        agentName: "A",
        taglines: [],
        model: { provider: "p", id: "i" },
        readiness: "ready",
      }),
      buildCommandResultViewModel({ ok: true, title: "T", blocks: [] }),
      buildPlainFallbackViewModel({ lines: ["line"] }),
    ];

    for (const vm of vms) {
      const out = r.render(vm);
      expect(typeof out).toBe("string");
    }
  });
});

describe("StandardRenderer — dark theme", () => {
  it("renders status with dark brand color", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "openrouter", id: "claude-sonnet-4" },
      securityMode: "open",
      skillCount: 12,
      skillAutonomy: "suggest",
      toolCount: 34,
      mcpActive: 2,
      mcpTotal: 3,
      taskflowActive: true,
    });
    const out = r.renderStatus(vm);
    expect(out).toContain("EstaCoda is ready");
    expect(out).toContain("model:");
    expect(out).toContain("security:");
    expect(hasAnsi(out)).toBe(true);
  });

  it("renders warning with dark severity colors", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildWarningErrorViewModel({
      severity: "error",
      title: "Fail",
      message: "Something broke",
    });
    const out = r.renderWarningError(vm);
    expect(out).toContain("[ERROR]");
    expect(out).toContain("Fail");
    expect(hasAnsi(out)).toBe(true);
  });

  it("renders table with colored header", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildTableViewModel({
      title: "Jobs",
      columns: [{ key: "name", header: "Name" }],
      rows: [{ name: "daily" }],
    });
    const out = r.renderTable(vm);
    expect(out).toContain("Jobs");
    expect(out).toContain("Name");
    expect(out).toContain("daily");
    expect(hasAnsi(out)).toBe(true);
  });

  it("renders approval in framed panel", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildApprovalSecurityViewModel({
      toolName: "terminal",
      riskClass: "destructive-local",
      targetSummary: "rm -rf /",
      severity: "warn",
      actions: [approvalAction("allow", "Allow")],
    });
    const out = r.renderApprovalSecurity(vm);
    expect(out).toContain("Approval required: terminal");
    expect(out).toContain("rm -rf /");
    expect(hasAnsi(out)).toBe(true);
  });

  it("renders startup hero panel", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildStartupViewModel({
      agentName: "EstaCoda",
      taglines: ["Kemet Research"],
      model: { provider: "p", id: "i" },
      readiness: "ready",
    });
    const out = r.renderStartup(vm);
    expect(out).toContain("EstaCoda");
    expect(out).toContain("Kemet Research");
    expect(out).toContain("readiness:");
    expect(hasAnsi(out)).toBe(true);
  });

  it("renders timeline with Unicode markers", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildActivityTimelineViewModel({
      events: [
        timelineEvent("terminal", "done", { elapsedMs: 1200 }),
        timelineEvent("web.extract", "failed"),
      ],
    });
    const out = r.renderActivityTimeline(vm);
    expect(out).toContain("terminal");
    expect(out).toContain("web.extract");
    expect(hasAnsi(out)).toBe(true);
  });

  it("renders progress with colored markers", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildProgressContextRailViewModel({
      steps: [
        progressStep("Done", "done"),
        progressStep("Active", "active"),
        progressStep("Pending", "pending"),
        progressStep("Failed", "failed"),
      ],
    });
    const out = r.renderProgressRail(vm);
    expect(out).toContain("Done");
    expect(out).toContain("Active");
    expect(out).toContain("Pending");
    expect(out).toContain("Failed");
    expect(hasAnsi(out)).toBe(true);
  });
});

describe("StandardRenderer — light theme", () => {
  it("renders status with light brand color", () => {
    const r = renderer("light", fullCaps());
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const out = r.renderStatus(vm);
    expect(out).toContain("EstaCoda is ready");
    expect(hasAnsi(out)).toBe(true);
  });

  it("uses different color values than dark", () => {
    const darkR = renderer("dark", fullCaps());
    const lightR = renderer("light", fullCaps());

    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });

    const darkOut = darkR.renderStatus(vm);
    const lightOut = lightR.renderStatus(vm);

    // Both have ANSI, but the escape sequences should differ
    expect(hasAnsi(darkOut)).toBe(true);
    expect(hasAnsi(lightOut)).toBe(true);
    expect(darkOut).not.toBe(lightOut);
  });
});

describe("StandardRenderer — no-color fallback", () => {
  it("produces no ANSI when color is disabled", () => {
    const r = renderer("dark", noColorCaps());
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const out = r.renderStatus(vm);
    assertNoAnsi(out);
    expect(out).toContain("EstaCoda is ready");
  });

  it("produces no ANSI for warnings", () => {
    const r = renderer("dark", noColorCaps());
    const vm = buildWarningErrorViewModel({
      severity: "error",
      title: "Fail",
      message: "Broke",
    });
    const out = r.renderWarningError(vm);
    assertNoAnsi(out);
  });

  it("produces no ANSI for approval panel", () => {
    const r = renderer("dark", noColorCaps());
    const vm = buildApprovalSecurityViewModel({
      toolName: "t",
      targetSummary: "s",
      severity: "warn",
      actions: [approvalAction("a", "A")],
    });
    const out = r.renderApprovalSecurity(vm);
    assertNoAnsi(out);
  });

  it("produces no ANSI for timeline", () => {
    const r = renderer("dark", noColorCaps());
    const vm = buildActivityTimelineViewModel({
      events: [timelineEvent("tool", "done")],
    });
    const out = r.renderActivityTimeline(vm);
    assertNoAnsi(out);
  });

  it("produces no ANSI for command result", () => {
    const r = renderer("dark", noColorCaps());
    const vm = buildCommandResultViewModel({
      ok: true,
      title: "Result",
      blocks: [buildKeyValueBlockViewModel({ entries: [kv("k", "v")] })],
    });
    const out = r.renderCommandResult(vm);
    assertNoAnsi(out);
  });
});

describe("StandardRenderer — no-Unicode fallback", () => {
  it("uses ASCII markers for timeline", () => {
    const r = renderer("dark", noUnicodeCaps());
    const vm = buildActivityTimelineViewModel({
      events: [
        timelineEvent("t", "pending"),
        timelineEvent("t", "running"),
        timelineEvent("t", "done"),
        timelineEvent("t", "failed"),
        timelineEvent("t", "gated"),
      ],
    });
    const out = r.renderActivityTimeline(vm);
    expect(out).toContain("[ ]");
    expect(out).toContain("[>]");
    expect(out).toContain("[x]");
    expect(out).toContain("[-]");
    expect(out).toContain("[?]");
  });

  it("uses ASCII markers for progress", () => {
    const r = renderer("dark", noUnicodeCaps());
    const vm = buildProgressContextRailViewModel({
      steps: [
        progressStep("a", "pending"),
        progressStep("b", "active"),
        progressStep("c", "done"),
        progressStep("d", "failed"),
      ],
    });
    const out = r.renderProgressRail(vm);
    expect(out).toContain("[ ]");
    expect(out).toContain("[>]");
    expect(out).toContain("[x]");
    expect(out).toContain("[-]");
  });

  it("uses ASCII bullet for list", () => {
    const r = renderer("dark", noUnicodeCaps());
    const vm = buildListViewModel({
      items: [listItem("item")],
    });
    const out = r.renderList(vm);
    // The bullet glyph fallback is "-"
    expect(out).toContain("-");
  });
});

describe("StandardRenderer — plain mode fallback", () => {
  it("produces no ANSI and no Unicode in plain mode", () => {
    const tokens = resolveTokens("plain", "light", "kemetBlue");
    const r = new StandardRenderer({ tokens, capabilities: plainCaps() });

    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const out = r.renderStatus(vm);
    assertNoAnsi(out);
    // Should use ASCII pipe "|" for rail
    expect(out).toContain("|");
  });

  it("plain fallback ViewModel passes through unchanged", () => {
    const tokens = resolveTokens("plain", "dark", "kemetBlue");
    const r = new StandardRenderer({ tokens, capabilities: plainCaps() });
    const vm = buildPlainFallbackViewModel({ lines: ["plain text"] });
    expect(r.renderPlainFallback(vm)).toBe("plain text");
  });
});

describe("StandardRenderer — narrow width", () => {
  it("renders within narrow terminal width", () => {
    const r = renderer("dark", narrowCaps());
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "very-long-provider-name", id: "very-long-model-id" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const out = r.renderStatus(vm);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("renders table within narrow width", () => {
    const r = renderer("dark", narrowCaps());
    const vm = buildTableViewModel({
      columns: [
        { key: "a", header: "A" },
        { key: "b", header: "B" },
      ],
      rows: [
        { a: "long-value-a", b: "long-value-b" },
      ],
    });
    const out = r.renderTable(vm);
    expect(out).toContain("long-value-a");
  });
});

describe("StandardRenderer — visual primitives", () => {
  it("renders status on rails", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const out = r.renderStatus(vm);
    // Rail uses toolPrefix glyph ("│" in Unicode mode)
    expect(out).toContain("│");
  });

  it("renders inline signals for severity", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildKeyValueBlockViewModel({
      entries: [
        kv("ok", "value", "ok"),
        kv("warn", "value", "warn"),
        kv("error", "value", "error"),
      ],
    });
    const out = r.renderKeyValueBlock(vm);
    expect(out).toContain("ok");
    expect(out).toContain("warn");
    expect(out).toContain("error");
  });

  it("renders framed focus panel for approval", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildApprovalSecurityViewModel({
      toolName: "terminal",
      targetSummary: "rm -rf /",
      severity: "warn",
      actions: [approvalAction("allow", "Allow")],
    });
    const out = r.renderApprovalSecurity(vm);
    // Box drawing chars
    expect(out).toContain("┌");
    expect(out).toContain("┐");
    expect(out).toContain("└");
    expect(out).toContain("┘");
    expect(out).toContain("│");
  });

  it("renders hero panel for startup", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildStartupViewModel({
      agentName: "EstaCoda",
      taglines: ["Kemet Research"],
      model: { provider: "p", id: "i" },
      readiness: "ready",
    });
    const out = r.renderStartup(vm);
    expect(out).toContain("EstaCoda");
    expect(out).toContain("Kemet Research");
  });
});

describe("StandardRenderer — empty and edge states", () => {
  it("renders empty table", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildTableViewModel({ columns: [], rows: [] });
    const out = r.renderTable(vm);
    expect(out).toContain("No data.");
  });

  it("renders empty list", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildListViewModel({ items: [] });
    const out = r.renderList(vm);
    expect(out).toContain("No items.");
  });

  it("renders empty timeline", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildActivityTimelineViewModel({ events: [] });
    const out = r.renderActivityTimeline(vm);
    expect(out).toContain("No activity.");
  });

  it("renders empty progress", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildProgressContextRailViewModel({ steps: [] });
    const out = r.renderProgressRail(vm);
    expect(out).toContain("No steps.");
  });

  it("renders command result with nested blocks", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildCommandResultViewModel({
      ok: false,
      title: "Error",
      blocks: [
        buildWarningErrorViewModel({
          severity: "error",
          title: "Detail",
          message: "Something failed",
        }),
        buildKeyValueBlockViewModel({
          entries: [kv("code", 500)],
        }),
      ],
    });
    const out = r.renderCommandResult(vm);
    expect(out).toContain("[FAIL]");
    expect(out).toContain("Detail");
    expect(out).toContain("500");
  });

  it("renders picker with selected option highlighted", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildPickerViewModel({
      title: "Choose",
      options: [
        pickerOption("a", "A", { selected: true }),
        pickerOption("b", "B"),
      ],
    });
    const out = r.renderPicker(vm);
    expect(out).toContain(">");
    expect(out).toContain("A");
    expect(out).toContain("B");
  });
});

describe("StandardRenderer — deterministic output", () => {
  it("produces identical output for identical input", () => {
    const r = renderer("dark", fullCaps());
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const a = r.render(vm);
    const b = r.render(vm);
    expect(a).toBe(b);
  });
});
