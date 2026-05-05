import { describe, it, expect } from "vitest";
import { resolveTokens } from "../theme/token-resolver.js";
import type { TerminalCapabilities } from "../contracts/ui.js";
import type { ViewModel } from "../contracts/view-model.js";
import {
  buildSlashMenuViewModel,
  buildToolsMenuViewModel,
  renderSlashMenu,
  renderToolsMenu,
} from "./slash-menu.js";
import { buildSessionHelpViewModel, renderSessionHelp } from "./session-help.js";
import { createSessionRenderer } from "./session-renderer.js";
import { StandardRenderer } from "../ui/renderers/standard-renderer.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";

// ──────────────────────────────────────
// Rendering context factories
// ──────────────────────────────────────

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

function ciCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    isCI: true,
    supportsAnimation: false,
  };
}

function dumbCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    isDumb: true,
    supportsAnimation: false,
  };
}

function nonTtyCaps(): TerminalCapabilities {
  return {
    ...fullCaps(),
    isTTY: false,
    supportsAnimation: false,
  };
}

// ──────────────────────────────────────
// Renderer factories per context
// ──────────────────────────────────────

function standardDarkRenderer() {
  const tokens = resolveTokens("standard", "dark", "kemetBlue");
  return new StandardRenderer({ tokens, capabilities: fullCaps() });
}

function standardLightRenderer() {
  const tokens = resolveTokens("standard", "light", "kemetBlue");
  return new StandardRenderer({ tokens, capabilities: fullCaps() });
}

function noColorRenderer() {
  const tokens = resolveTokens("standard", "dark", "kemetBlue");
  return new StandardRenderer({ tokens, capabilities: noColorCaps() });
}

function noUnicodeRenderer() {
  const tokens = resolveTokens("standard", "dark", "kemetBlue");
  return new StandardRenderer({ tokens, capabilities: noUnicodeCaps() });
}

function narrowRenderer() {
  const tokens = resolveTokens("standard", "dark", "kemetBlue");
  return new StandardRenderer({ tokens, capabilities: narrowCaps() });
}

function plainRenderer() {
  return { render: renderPlain };
}

// ──────────────────────────────────────
// Fake runtime for /status and /model
// ──────────────────────────────────────

function fakeStatusViewModel(): ViewModel {
  return {
    kind: "status",
    agentName: "EstaCoda",
    model: { provider: "unconfigured", id: "smoke-model" },
    securityMode: "adaptive",
    skillCount: 3,
    skillAutonomy: "suggest",
    toolCount: 12,
    mcp: { active: 1, total: 2 },
    taskflowActive: false,
    warnings: [],
  };
}

function fakeModelInfoViewModel(): ViewModel {
  return {
    kind: "kv",
    title: "Model",
    entries: [
      { key: "provider", value: "unconfigured" },
      { key: "model", value: "smoke-model" },
      { key: "context window", value: "unknown" },
      { key: "security mode", value: "adaptive" },
    ],
  };
}

// Fake runtime interface for menu builders
const fakeRuntime = {
  tools: () => [],
  skills: () => [],
} as unknown as Parameters<typeof buildSlashMenuViewModel>[0];

// ──────────────────────────────────────
// Snapshot helpers
// ──────────────────────────────────────

function snapshotContexts() {
  return [
    { name: "plain", renderer: plainRenderer() },
    { name: "standard dark", renderer: standardDarkRenderer() },
    { name: "standard light", renderer: standardLightRenderer() },
    { name: "no color", renderer: noColorRenderer() },
    { name: "no Unicode", renderer: noUnicodeRenderer() },
    { name: "narrow width", renderer: narrowRenderer() },
  ];
}

// ──────────────────────────────────────
// Test suites
// ──────────────────────────────────────

describe("Session surfaces — /status", () => {
  for (const ctx of snapshotContexts()) {
    it(`renders in ${ctx.name}`, () => {
      const output = ctx.renderer.render(fakeStatusViewModel());
      expect(output).toMatchSnapshot(`status-${ctx.name}`);
    });
  }
});

describe("Session surfaces — /model", () => {
  for (const ctx of snapshotContexts()) {
    it(`renders in ${ctx.name}`, () => {
      const output = ctx.renderer.render(fakeModelInfoViewModel());
      expect(output).toMatchSnapshot(`model-${ctx.name}`);
    });
  }
});

describe("Session surfaces — /help", () => {
  for (const ctx of snapshotContexts()) {
    it(`renders in ${ctx.name}`, () => {
      const vm = buildSessionHelpViewModel();
      const output = ctx.renderer.render(vm);
      expect(output).toMatchSnapshot(`help-${ctx.name}`);
    });
  }
});

describe("Session surfaces — /tools", () => {
  for (const ctx of snapshotContexts()) {
    it(`renders in ${ctx.name}`, () => {
      const vm = buildToolsMenuViewModel(fakeRuntime, "");
      const output = ctx.renderer.render(vm);
      expect(output).toMatchSnapshot(`tools-${ctx.name}`);
    });
  }
});

describe("Session surfaces — slash menu", () => {
  for (const ctx of snapshotContexts()) {
    it(`renders in ${ctx.name}`, () => {
      const vm = buildSlashMenuViewModel(fakeRuntime, "");
      const output = ctx.renderer.render(vm);
      expect(output).toMatchSnapshot(`slash-menu-${ctx.name}`);
    });
  }
});

describe("Session surfaces — unknown-command fallback", () => {
  for (const ctx of snapshotContexts()) {
    it(`renders in ${ctx.name}`, () => {
      const vm = buildSlashMenuViewModel(fakeRuntime, "nonexistent");
      const output = ctx.renderer.render(vm);
      expect(output).toMatchSnapshot(`unknown-command-${ctx.name}`);
    });
  }
});

// ──────────────────────────────────────
// SessionRenderer factory selection logic
// ──────────────────────────────────────

describe("createSessionRenderer — selection logic", () => {
  it("returns plain renderer for non-TTY output", () => {
    const renderer = createSessionRenderer({ capabilities: nonTtyCaps() });
    const vm = fakeStatusViewModel();
    const output = renderer.render(vm);
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("returns plain renderer for CI environment", () => {
    const renderer = createSessionRenderer({ capabilities: ciCaps() });
    const vm = fakeStatusViewModel();
    const output = renderer.render(vm);
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("returns plain renderer for dumb terminal", () => {
    const renderer = createSessionRenderer({ capabilities: dumbCaps() });
    const vm = fakeStatusViewModel();
    const output = renderer.render(vm);
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("returns plain renderer for no-color caps", () => {
    const renderer = createSessionRenderer({ capabilities: noColorCaps() });
    const vm = fakeStatusViewModel();
    const output = renderer.render(vm);
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("returns standard renderer for full TTY caps", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps() });
    const vm = fakeStatusViewModel();
    const output = renderer.render(vm);
    expect(output).toMatch(/\x1b\[/);
  });

  it("returns plain renderer for explicit plain mode", () => {
    const renderer = createSessionRenderer({ capabilities: fullCaps(), mode: "plain" });
    const vm = fakeStatusViewModel();
    const output = renderer.render(vm);
    expect(output).not.toMatch(/\x1b\[/);
  });
});

// ──────────────────────────────────────
// Backward-compatibility: string wrappers
// ──────────────────────────────────────

describe("Backward-compatible string wrappers", () => {
  it("renderSlashMenu still returns a string", () => {
    const output = renderSlashMenu(fakeRuntime);
    expect(typeof output).toBe("string");
  });

  it("renderToolsMenu still returns a string", () => {
    const output = renderToolsMenu(fakeRuntime);
    expect(typeof output).toBe("string");
  });

  it("renderSessionHelp still returns a string", () => {
    const output = renderSessionHelp();
    expect(typeof output).toBe("string");
  });
});
