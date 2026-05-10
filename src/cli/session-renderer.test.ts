import { describe, it, expect } from "vitest";
import { createSessionRenderer } from "./session-renderer.js";
import { resolveTokens } from "../theme/token-resolver.js";
import { StandardRenderer } from "../ui/renderers/standard-renderer.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import { buildConversationMessageViewModel } from "../ui/view-models/builders.js";
import type { TerminalCapabilities } from "../contracts/ui.js";

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

describe("createSessionRenderer — locale default", () => {
  it("defaults to en locale", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps() });
    expect(renderer.locale).toBe("en");
  });

  it("preserves explicit en locale", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps(), locale: "en" });
    expect(renderer.locale).toBe("en");
  });

  it("allows ar locale selection", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps(), locale: "ar" });
    expect(renderer.locale).toBe("ar");
  });
});

describe("createSessionRenderer — standard renderer locale", () => {
  it("renders assistant card title in English by default", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps() });
    const vm = buildConversationMessageViewModel({ role: "assistant", text: "Hello." });
    const out = renderer.render(vm);
    expect(out).toContain("EstaCoda");
  });

  it("renders assistant card title in Arabic when locale is ar", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps(), locale: "ar" });
    const vm = buildConversationMessageViewModel({ role: "assistant", text: "Hello." });
    const out = renderer.render(vm);
    expect(out).toContain("إستاكودا");
  });

  it("uses ASCII assistant title in no-Unicode mode even for ar", () => {
    const caps = { ...fullCaps(), supportsUnicode: false };
    const renderer = createSessionRenderer({ capabilities: caps, locale: "ar" });
    const vm = buildConversationMessageViewModel({ role: "assistant", text: "Hello." });
    const out = renderer.render(vm);
    expect(out).toContain("* إستاكودا");
    expect(out).not.toContain("𓂀");
  });
});

describe("createSessionRenderer — plain renderer locale", () => {
  it("renders assistant card fallback in English by default", () => {
    const renderer = createSessionRenderer({ capabilities: plainCaps() });
    const vm = buildConversationMessageViewModel({ role: "assistant", text: "Hello." });
    const out = renderer.render(vm);
    expect(out).toContain("EstaCoda:");
  });

  it("renders assistant card fallback in Arabic when locale is ar", () => {
    const renderer = createSessionRenderer({ capabilities: plainCaps(), locale: "ar" });
    const vm = buildConversationMessageViewModel({ role: "assistant", text: "Hello." });
    const out = renderer.render(vm);
    expect(out).toContain("إستاكودا:");
  });

  it("respects explicit vm.label over copy boundary in plain mode", () => {
    const renderer = createSessionRenderer({ capabilities: plainCaps(), locale: "ar" });
    const vm = buildConversationMessageViewModel({
      role: "assistant",
      text: "Hello.",
      label: "CustomBot",
    });
    const out = renderer.render(vm);
    expect(out).toContain("CustomBot:");
    expect(out).not.toContain("إستاكودا");
  });
});

describe("createSessionRenderer — legacy command output stays English", () => {
  it("status output is English regardless of locale", () => {
    const renderer = createSessionRenderer({ capabilities: plainCaps(), locale: "ar" });
    const vm = {
      kind: "status" as const,
      agentName: "EstaCoda",
      model: { provider: "p", id: "i" },
      securityMode: "open",
      skillCount: 1,
      toolCount: 1,
      mcp: { active: 0, total: 0 },
      taskflowActive: false,
      warnings: [],
    };
    const out = renderer.render(vm);
    expect(out).toContain("EstaCoda is ready");
    expect(out).toContain("model:");
    expect(out).toContain("security:");
    expect(out).not.toContain("النموذج"); // model in Arabic should NOT appear in legacy status
  });

  it("table output is English regardless of locale", () => {
    const renderer = createSessionRenderer({ capabilities: plainCaps(), locale: "ar" });
    const vm = {
      kind: "table" as const,
      title: "Jobs",
      columns: [{ key: "name", header: "Name" }],
      rows: [{ name: "daily" }],
    };
    const out = renderer.render(vm);
    expect(out).toContain("Jobs");
    expect(out).toContain("Name");
    expect(out).toContain("daily");
  });
});
