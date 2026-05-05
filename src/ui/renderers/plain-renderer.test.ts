import { describe, it, expect } from "vitest";
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
import {
  renderPlain,
  renderPlainFallback,
  renderWarningError,
  renderStatus,
  renderTable,
  renderKeyValueBlock,
  renderList,
  renderApprovalSecurity,
  renderActivityTimeline,
  renderProgressRail,
  renderPicker,
  renderStartup,
  renderCommandResult,
} from "./plain-renderer.js";

function assertNoAnsi(text: string): void {
  expect(text).not.toMatch(/\x1b\[/);
}

function assertAsciiSafe(text: string): void {
  for (const ch of text) {
    expect(ch.charCodeAt(0)).toBeLessThan(128);
  }
}

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderPlainFallback", () => {
  it("renders lines joined by newline", () => {
    const vm = buildPlainFallbackViewModel({
      lines: ["line one", "line two", "line three"],
    });
    expect(renderPlainFallback(vm)).toBe("line one\nline two\nline three");
  });

  it("renders empty lines as empty string", () => {
    const vm = buildPlainFallbackViewModel({ lines: [] });
    expect(renderPlainFallback(vm)).toBe("");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderWarningError", () => {
  it("renders error with title and message", () => {
    const vm = buildWarningErrorViewModel({
      severity: "error",
      title: "Missing config",
      message: "BOT_TOKEN is not set",
    });
    const out = renderWarningError(vm);
    expect(out).toBe("[ERROR] Missing config: BOT_TOKEN is not set");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders warn with details", () => {
    const vm = buildWarningErrorViewModel({
      severity: "warn",
      title: "Skill load",
      message: "1 warning",
      details: ["foo.skill missing description"],
    });
    const out = renderWarningError(vm);
    expect(out).toBe("[WARN] Skill load: 1 warning\n  foo.skill missing description");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders info without details", () => {
    const vm = buildWarningErrorViewModel({
      severity: "info",
      title: "Note",
      message: "All systems nominal",
    });
    expect(renderWarningError(vm)).toBe("[INFO] Note: All systems nominal");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderStatus", () => {
  it("renders full status block", () => {
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
    const out = renderStatus(vm);
    expect(out).toContain("EstaCoda is ready");
    expect(out).toContain("model: openrouter/claude-sonnet-4");
    expect(out).toContain("security: open");
    expect(out).toContain("skills: 12 (suggest)");
    expect(out).toContain("tools: 34");
    expect(out).toContain("mcp: 2/3");
    expect(out).toContain("taskflow: active");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders without skillAutonomy when omitted", () => {
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "closed",
      skillCount: 0,
      toolCount: 0,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
    });
    const out = renderStatus(vm);
    expect(out).toContain("skills: 0");
    expect(out).not.toContain("skills: 0 (");
  });

  it("renders warnings inline", () => {
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcpActive: 0,
      mcpTotal: 0,
      taskflowActive: false,
      warnings: [
        buildWarningErrorViewModel({ severity: "warn", title: "T", message: "M" }),
      ],
    });
    const out = renderStatus(vm);
    expect(out).toContain("[WARN] T: M");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderTable", () => {
  it("renders table with title", () => {
    const vm = buildTableViewModel({
      title: "Cron jobs",
      columns: [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
        { key: "status", header: "Status", alignment: "center" },
      ],
      rows: [
        { id: "job-1", name: "Daily report", status: "active" },
        { id: "job-2", name: "Weekly sync", status: "paused" },
      ],
    });
    const out = renderTable(vm);
    expect(out).toContain("Cron jobs");
    expect(out).toContain("ID");
    expect(out).toContain("Daily report");
    expect(out).toContain("active");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders empty table with custom message", () => {
    const vm = buildTableViewModel({
      title: "Jobs",
      columns: [{ key: "id", header: "ID" }],
      rows: [],
      emptyMessage: "No jobs found.",
    });
    expect(renderTable(vm)).toBe("Jobs\nNo jobs found.");
  });

  it("renders empty table with default message", () => {
    const vm = buildTableViewModel({
      columns: [{ key: "id", header: "ID" }],
      rows: [],
    });
    expect(renderTable(vm)).toBe("No data.");
  });

  it("right-aligns numeric columns", () => {
    const vm = buildTableViewModel({
      columns: [
        { key: "name", header: "Name", alignment: "left" },
        { key: "count", header: "Count", alignment: "right" },
      ],
      rows: [
        { name: "A", count: 1 },
        { name: "BB", count: 22 },
      ],
    });
    const out = renderTable(vm);
    const lines = out.split("\n");
    const dataLine = lines[lines.length - 2]; // second to last row
    expect(dataLine).toMatch(/A\s+1/);
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderKeyValueBlock", () => {
  it("renders title and entries", () => {
    const vm = buildKeyValueBlockViewModel({
      title: "Channel status",
      entries: [
        kv("Telegram", "ready", "ok"),
        kv("Discord", "not ready", "warn"),
        kv("Email", "disabled"),
      ],
    });
    const out = renderKeyValueBlock(vm);
    expect(out).toContain("Channel status");
    expect(out).toContain("[OK] Telegram: ready");
    expect(out).toContain("[WARN] Discord: not ready");
    expect(out).toContain("Email: disabled");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders without title", () => {
    const vm = buildKeyValueBlockViewModel({
      entries: [kv("key", "value")],
    });
    expect(renderKeyValueBlock(vm)).toBe("key: value");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderList", () => {
  it("renders unordered list with title", () => {
    const vm = buildListViewModel({
      title: "Platforms",
      items: [listItem("telegram"), listItem("discord", "ready", "ok")],
    });
    const out = renderList(vm);
    expect(out).toContain("Platforms");
    expect(out).toContain("- telegram");
    expect(out).toContain("- [OK] discord: ready");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders ordered list", () => {
    const vm = buildListViewModel({
      items: [listItem("a"), listItem("b")],
      ordered: true,
    });
    const out = renderList(vm);
    expect(out).toContain("1. a");
    expect(out).toContain("2. b");
  });

  it("renders empty list with custom message", () => {
    const vm = buildListViewModel({
      title: "Items",
      items: [],
      emptyMessage: "none",
    });
    expect(renderList(vm)).toBe("Items\nnone");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderApprovalSecurity", () => {
  it("renders approval prompt", () => {
    const vm = buildApprovalSecurityViewModel({
      toolName: "terminal",
      riskClass: "destructive-local",
      targetSummary: "rm -rf /home/user/project",
      severity: "warn",
      actions: [
        approvalAction("allow", "Allow once", "ok"),
        approvalAction("deny", "Deny", "error"),
      ],
      details: ["This action cannot be undone"],
    });
    const out = renderApprovalSecurity(vm);
    expect(out).toContain("[WARN] Approval required: terminal");
    expect(out).toContain("Target: rm -rf /home/user/project");
    expect(out).toContain("Risk: destructive-local");
    expect(out).toContain("  This action cannot be undone");
    expect(out).toContain("Actions:");
    expect(out).toContain("  allow) [OK] Allow once");
    expect(out).toContain("  deny) [ERROR] Deny");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders approval without riskClass or details", () => {
    const vm = buildApprovalSecurityViewModel({
      toolName: "web.search",
      targetSummary: "search query",
      severity: "info",
      actions: [approvalAction("allow", "Allow")],
    });
    const out = renderApprovalSecurity(vm);
    expect(out).toContain("[INFO] Approval required: web.search");
    expect(out).not.toContain("Risk:");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderActivityTimeline", () => {
  it("renders timeline events", () => {
    const vm = buildActivityTimelineViewModel({
      events: [
        timelineEvent("terminal", "running", { elapsedMs: 1200 }),
        timelineEvent("web.extract", "done", {
          elapsedMs: 3400,
          chars: 1200,
          sentChars: 800,
        }),
        timelineEvent("terminal", "gated", {
          decision: "ask",
          riskClass: "destructive-local",
        }),
      ],
    });
    const out = renderActivityTimeline(vm);
    expect(out).toContain("[>] terminal | 1.2s");
    expect(out).toContain("[x] web.extract | 3.4s | 1.2k captured / 800 sent");
    expect(out).toContain("[?] terminal | decision: ask | risk: destructive-local");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders empty timeline", () => {
    const vm = buildActivityTimelineViewModel({ events: [] });
    expect(renderActivityTimeline(vm)).toBe("No activity.");
  });

  it("renders truncated event", () => {
    const vm = buildActivityTimelineViewModel({
      events: [
        timelineEvent("web.extract", "done", {
          chars: 1500,
          sentChars: 900,
          truncated: true,
        }),
      ],
    });
    const out = renderActivityTimeline(vm);
    expect(out).toContain("/ compressed");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderProgressRail", () => {
  it("renders progress steps", () => {
    const vm = buildProgressContextRailViewModel({
      title: "Setup",
      steps: [
        progressStep("Config loaded", "done"),
        progressStep("Skills loaded", "done"),
        progressStep("MCP connected", "active"),
        progressStep("Ready", "pending"),
      ],
    });
    const out = renderProgressRail(vm);
    expect(out).toContain("Setup");
    expect(out).toContain("[x] Config loaded");
    expect(out).toContain("[>] MCP connected");
    expect(out).toContain("[ ] Ready");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders failed step", () => {
    const vm = buildProgressContextRailViewModel({
      steps: [progressStep("Load", "failed")],
    });
    expect(renderProgressRail(vm)).toContain("[-] Load");
  });

  it("renders empty progress", () => {
    const vm = buildProgressContextRailViewModel({ steps: [] });
    expect(renderProgressRail(vm)).toBe("No steps.");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderPicker", () => {
  it("renders picker with selected option", () => {
    const vm = buildPickerViewModel({
      title: "Select a model",
      options: [
        pickerOption("claude", "Claude", { selected: true }),
        pickerOption("gpt", "GPT", { description: "Fast" }),
        pickerOption("gemini", "Gemini"),
      ],
    });
    const out = renderPicker(vm);
    expect(out).toContain("Select a model");
    expect(out).toContain(">  1) Claude");
    expect(out).toContain("   2) GPT");
    expect(out).toContain("     Fast");
    expect(out).toContain("   3) Gemini");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders picker without selection", () => {
    const vm = buildPickerViewModel({
      title: "Choose",
      options: [pickerOption("a", "A")],
    });
    const out = renderPicker(vm);
    expect(out).toContain("  1) A");
    expect(out).not.toContain(">");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderStartup", () => {
  it("renders startup with taglines and warnings", () => {
    const vm = buildStartupViewModel({
      agentName: "EstaCoda",
      taglines: ["Kemet Research", "Autonomous Engineering"],
      model: { provider: "openrouter", id: "claude-sonnet-4" },
      readiness: "ready",
      warnings: [],
    });
    const out = renderStartup(vm);
    expect(out).toContain("EstaCoda");
    expect(out).toContain("Kemet Research");
    expect(out).toContain("Autonomous Engineering");
    expect(out).toContain("model: openrouter/claude-sonnet-4");
    expect(out).toContain("readiness: ready");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders degraded readiness with warnings", () => {
    const vm = buildStartupViewModel({
      agentName: "EstaCoda",
      taglines: [],
      model: { provider: "p", id: "i" },
      readiness: "degraded",
      warnings: [
        buildWarningErrorViewModel({
          severity: "warn",
          title: "Config",
          message: "Missing",
        }),
      ],
    });
    const out = renderStartup(vm);
    expect(out).toContain("readiness: degraded");
    expect(out).toContain("[WARN] Config: Missing");
  });

  it("skips empty taglines", () => {
    const vm = buildStartupViewModel({
      agentName: "X",
      taglines: ["", "Valid"],
      model: { provider: "p", id: "i" },
      readiness: "ready",
    });
    const out = renderStartup(vm);
    expect(out).not.toContain("\n\n");
    expect(out).toContain("Valid");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderCommandResult", () => {
  it("renders ok result with blocks", () => {
    const vm = buildCommandResultViewModel({
      ok: true,
      title: "Gateway status",
      blocks: [
        buildKeyValueBlockViewModel({
          entries: [kv("Channels", "4")],
        }),
        buildListViewModel({
          items: [listItem("telegram")],
        }),
      ],
    });
    const out = renderCommandResult(vm);
    expect(out).toContain("[OK] Gateway status");
    expect(out).toContain("Channels: 4");
    expect(out).toContain("- telegram");
    assertNoAnsi(out);
    assertAsciiSafe(out);
  });

  it("renders fail result without blocks", () => {
    const vm = buildCommandResultViewModel({
      ok: false,
      title: "Error",
      blocks: [],
    });
    expect(renderCommandResult(vm)).toBe("[FAIL] Error");
  });

  it("renders nested command result recursively", () => {
    const inner = buildCommandResultViewModel({
      ok: true,
      title: "Inner",
      blocks: [buildPlainFallbackViewModel({ lines: ["inner line"] })],
    });
    const vm = buildCommandResultViewModel({
      ok: true,
      title: "Outer",
      blocks: [inner],
    });
    const out = renderCommandResult(vm);
    expect(out).toContain("[OK] Outer");
    expect(out).toContain("[OK] Inner");
    expect(out).toContain("inner line");
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — renderPlain dispatcher", () => {
  it("dispatches all ViewModel kinds correctly", () => {
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
      const out = renderPlain(vm);
      expect(typeof out).toBe("string");
      assertNoAnsi(out);
      assertAsciiSafe(out);
    }
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — deterministic output", () => {
  it("produces identical output for identical input", () => {
    const vm = buildStatusViewModel({
      agentName: "EstaCoda",
      model: { provider: "openrouter", id: "claude-sonnet-4" },
      securityMode: "open",
      skillCount: 5,
      toolCount: 10,
      mcpActive: 1,
      mcpTotal: 2,
      taskflowActive: true,
    });
    const a = renderPlain(vm);
    const b = renderPlain(vm);
    expect(a).toBe(b);
  });

  it("produces identical output for identical complex input", () => {
    const vm = buildCommandResultViewModel({
      ok: true,
      title: "Result",
      blocks: [
        buildTableViewModel({
          columns: [
            { key: "a", header: "A" },
            { key: "b", header: "B" },
          ],
          rows: [{ a: "1", b: "2" }],
        }),
        buildListViewModel({
          items: [listItem("x"), listItem("y")],
        }),
      ],
    });
    const a = renderPlain(vm);
    const b = renderPlain(vm);
    expect(a).toBe(b);
  });
});

// ──────────────────────────────────────────────────
describe("PlainRenderer — edge cases", () => {
  it("handles undefined table cells", () => {
    const vm = buildTableViewModel({
      columns: [{ key: "a", header: "A" }],
      rows: [{ a: undefined }],
    });
    const out = renderTable(vm);
    expect(out).toContain("A");
    expect(out).toContain("-");
  });

  it("handles boolean table cells", () => {
    const vm = buildTableViewModel({
      columns: [{ key: "flag", header: "Flag" }],
      rows: [{ flag: true }, { flag: false }],
    });
    const out = renderTable(vm);
    expect(out).toContain("true");
    expect(out).toContain("false");
  });

  it("handles numeric table cells", () => {
    const vm = buildTableViewModel({
      columns: [{ key: "n", header: "N" }],
      rows: [{ n: 42 }],
    });
    expect(renderTable(vm)).toContain("42");
  });

  it("handles timeline event with only tool and status", () => {
    const vm = buildActivityTimelineViewModel({
      events: [timelineEvent("tool", "pending")],
    });
    expect(renderActivityTimeline(vm)).toBe("[ ] tool");
  });

  it("handles timeline duration formatting for ms", () => {
    const vm = buildActivityTimelineViewModel({
      events: [timelineEvent("t", "done", { elapsedMs: 500 })],
    });
    expect(renderActivityTimeline(vm)).toContain("500ms");
  });

  it("handles timeline duration formatting for seconds", () => {
    const vm = buildActivityTimelineViewModel({
      events: [timelineEvent("t", "done", { elapsedMs: 2500 })],
    });
    expect(renderActivityTimeline(vm)).toContain("2.5s");
  });

  it("handles count formatting for thousands", () => {
    const vm = buildActivityTimelineViewModel({
      events: [timelineEvent("t", "done", { chars: 1500, sentChars: 900 })],
    });
    expect(renderActivityTimeline(vm)).toContain("1.5k captured / 900 sent");
  });

  it("handles empty taglines in startup", () => {
    const vm = buildStartupViewModel({
      agentName: "X",
      taglines: [],
      model: { provider: "p", id: "i" },
      readiness: "ready",
    });
    const out = renderStartup(vm);
    expect(out).toBe("X\nmodel: p/i\nreadiness: ready");
  });

  it("handles kv block with numeric and boolean values", () => {
    const vm = buildKeyValueBlockViewModel({
      entries: [
        kv("count", 42),
        kv("flag", true),
      ],
    });
    const out = renderKeyValueBlock(vm);
    expect(out).toContain("count: 42");
    expect(out).toContain("flag: true");
  });

  it("handles list item without value", () => {
    const vm = buildListViewModel({
      items: [listItem("label")],
    });
    expect(renderList(vm)).toBe("- label");
  });

  it("handles picker with empty options", () => {
    const vm = buildPickerViewModel({ title: "Choose", options: [] });
    expect(renderPicker(vm)).toBe("Choose");
  });

  it("handles progress rail with title and empty steps", () => {
    const vm = buildProgressContextRailViewModel({
      title: "Steps",
      steps: [],
    });
    expect(renderProgressRail(vm)).toBe("Steps\nNo steps.");
  });
});
