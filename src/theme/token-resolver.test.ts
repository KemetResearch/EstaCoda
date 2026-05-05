import { describe, it, expect } from "vitest";
import { resolveTokens, getBaseTheme } from "./token-resolver.js";

describe("resolveTokens", () => {
  it("resolves standard + light + kemetBlue", () => {
    const r = resolveTokens("standard", "light", "kemetBlue");
    expect(r.mode).toBe("standard");
    expect(r.theme).toBe("light");
    expect(r.skin).toBe("kemetBlue");
    expect(r.contract.palette.brand).toBe("#0057D9");
    expect(r.contract.palette.action).toBe("#008C95");
    expect(r.contract.palette.caution).toBe("#B45309");
    expect(r.contract.behavior.allowAnsiColor).toBe(true);
    expect(r.contract.behavior.allowAnimation).toBe(true);
  });

  it("resolves standard + dark + kemetBlue", () => {
    const r = resolveTokens("standard", "dark", "kemetBlue");
    expect(r.theme).toBe("dark");
    expect(r.contract.palette.brand).toBe("#5AACFF");
    expect(r.contract.palette.action).toBe("#40E0D0");
    expect(r.contract.palette.caution).toBe("#FFB454");
    expect(r.contract.surface.bg).toBe("#1A1A1A");
  });

  it("resolves plain + light + kemetBlue", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    expect(r.mode).toBe("plain");
    expect(r.skin).toBe("kemetBlue");
    expect(r.contract.glyph.prompt).toBe(">");
    expect(r.contract.glyph.spinner.waiting).toEqual(["|", "/", "-", "\\"]);
    expect(r.contract.behavior.allowAnsiColor).toBe(false);
    expect(r.contract.behavior.allowAnimation).toBe(false);
    expect(r.contract.behavior.allowEmoji).toBe(false);
  });

  it("resolves plain + dark + kemetBlue", () => {
    const r = resolveTokens("plain", "dark", "kemetBlue");
    expect(r.contract.surface.bg).toBe("#1A1A1A");
    expect(r.contract.glyph.prompt).toBe(">");
    expect(r.contract.behavior.allowAnsiColor).toBe(false);
  });

  it("defaults skin to kemetBlue when omitted", () => {
    const r = resolveTokens("standard", "light");
    expect(r.skin).toBe("kemetBlue");
  });
});

describe("theme invariants", () => {
  it("light brand is #0057D9", () => {
    const t = getBaseTheme("light");
    expect(t.palette.brand).toBe("#0057D9");
  });

  it("dark brand is #5AACFF", () => {
    const t = getBaseTheme("dark");
    expect(t.palette.brand).toBe("#5AACFF");
  });

  it("light action accent is turquoise #008C95", () => {
    const t = getBaseTheme("light");
    expect(t.palette.action).toBe("#008C95");
  });

  it("dark action accent is turquoise #40E0D0", () => {
    const t = getBaseTheme("dark");
    expect(t.palette.action).toBe("#40E0D0");
  });

  it("light caution accent is amber #B45309", () => {
    const t = getBaseTheme("light");
    expect(t.palette.caution).toBe("#B45309");
  });

  it("dark caution accent is amber #FFB454", () => {
    const t = getBaseTheme("dark");
    expect(t.palette.caution).toBe("#FFB454");
  });

  it("severity colors are semantic, not brand", () => {
    const light = getBaseTheme("light");
    expect(light.severity.ok).not.toBe(light.palette.brand);
    expect(light.severity.error).not.toBe(light.palette.brand);
    expect(light.severity.warn).not.toBe(light.palette.brand);
  });

  it("surfaces are neutral in light theme", () => {
    const t = getBaseTheme("light");
    expect(t.surface.bg).toBe("#FFFFFF");
    expect(t.surface.bgElevated).toBe("#F5F5F5");
  });

  it("surfaces are neutral in dark theme", () => {
    const t = getBaseTheme("dark");
    expect(t.surface.bg).toBe("#1A1A1A");
    expect(t.surface.bgElevated).toBe("#252525");
  });
});

describe("plain mode invariants", () => {
  it("plain forces ASCII prompt", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    expect(r.contract.glyph.prompt).toBe(">");
  });

  it("plain forces ASCII spinner", () => {
    const r = resolveTokens("plain", "dark", "kemetBlue");
    const frames = r.contract.glyph.spinner.waiting;
    for (const f of frames) {
      expect(f.charCodeAt(0)).toBeLessThan(128);
    }
  });

  it("plain forces ASCII tool icons", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    for (const icon of Object.values(r.contract.toolIcon)) {
      expect(icon.charCodeAt(0)).toBeLessThan(128);
    }
  });

  it("plain disables ANSI color", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    expect(r.contract.behavior.allowAnsiColor).toBe(false);
  });

  it("plain disables animation", () => {
    const r = resolveTokens("plain", "dark", "kemetBlue");
    expect(r.contract.behavior.allowAnimation).toBe(false);
  });

  it("plain strips Unicode branding symbols", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    // No Egyptian eye, no ankh, no Unicode frames in branding
    expect(r.contract.branding.responseLabel).toBe("EstaCoda");
    expect(r.contract.branding.taglinePrimary).toBe("Kemet Research");
    expect(r.contract.branding.taglineSecondary).toBe("");
    expect(r.contract.branding.helpHeader).toBe("Available Commands");
  });

  it("plain keeps branding text labels ASCII-safe", () => {
    const r = resolveTokens("plain", "dark", "kemetBlue");
    expect(r.contract.branding.responseLabel).toBe("EstaCoda");
    expect(r.contract.branding.taglinePrimary).toBe("Kemet Research");
    for (const value of Object.values(r.contract.branding)) {
      if (typeof value === "string" && value.length > 0) {
        for (const ch of value) {
          expect(ch.charCodeAt(0)).toBeLessThan(128);
        }
      }
    }
  });
});

describe("kemetBlue skin overlay", () => {
  it("preserves base theme brand color in light", () => {
    const r = resolveTokens("standard", "light", "kemetBlue");
    expect(r.contract.palette.brand).toBe("#0057D9");
  });

  it("preserves base theme brand color in dark", () => {
    const r = resolveTokens("standard", "dark", "kemetBlue");
    expect(r.contract.palette.brand).toBe("#5AACFF");
  });

  it("overrides branding", () => {
    const base = getBaseTheme("light");
    const skinned = resolveTokens("standard", "light", "kemetBlue");
    expect(skinned.contract.branding.taglinePrimary).not.toBe(
      base.branding.taglinePrimary
    );
  });

  it("overrides spinner glyphs", () => {
    const r = resolveTokens("standard", "light", "kemetBlue");
    expect(r.contract.glyph.spinner.waiting).toContain("(\u2326)");
  });

  it("overrides tool icons", () => {
    const r = resolveTokens("standard", "dark", "kemetBlue");
    expect(r.contract.toolIcon.terminal).toBe("\u2318");
  });

  it("uses approved Arabic tagline", () => {
    const r = resolveTokens("standard", "light", "kemetBlue");
    expect(r.contract.branding.taglineSecondary).toBe(
      "\u0627\u0644\u0633\u064a\u0627\u062f\u0629 \u0627\u0644\u062a\u0643\u0646\u0648\u0644\u0648\u062c\u064a\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629"
    );
  });
});

describe("skin overlay precedence", () => {
  it("plain overlay wins over skin for behavior", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    expect(r.contract.behavior.allowAnsiColor).toBe(false);
    expect(r.contract.behavior.allowAnimation).toBe(false);
  });

  it("plain overlay wins over skin for glyphs", () => {
    const r = resolveTokens("plain", "light", "kemetBlue");
    expect(r.contract.glyph.prompt).toBe(">");
  });

  it("plain strips skin Unicode branding even with kemetBlue", () => {
    const r = resolveTokens("plain", "dark", "kemetBlue");
    expect(r.contract.branding.taglinePrimary).toBe("Kemet Research");
    expect(r.contract.branding.taglineSecondary).toBe("");
  });
});
