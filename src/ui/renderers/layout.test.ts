import { describe, it, expect } from "vitest";
import { measureTextWidth, wrapText, truncateText } from "./layout.js";

describe("measureTextWidth", () => {
  it("measures ASCII text as 1 per char", () => {
    expect(measureTextWidth("hello")).toBe(5);
    expect(measureTextWidth("Hello World")).toBe(11);
  });

  it("measures empty string as 0", () => {
    expect(measureTextWidth("")).toBe(0);
  });

  it("measures full-width CJK chars as 2", () => {
    expect(measureTextWidth("中文")).toBe(4); // two CJK chars
    expect(measureTextWidth("日本語")).toBe(6);
  });

  it("measures combining chars as 0", () => {
    expect(measureTextWidth("e\u0301")).toBe(1); // e + combining acute
  });

  it("measures Egyptian hieroglyphs as 2", () => {
    expect(measureTextWidth("ገ0")).toBe(2);
  });

  it("measures emoji as 2", () => {
    expect(measureTextWidth("😀")).toBe(2);
    expect(measureTextWidth("⚠")).toBe(2);
  });

  it("measures mixed-script text", () => {
    const text = "Hello العربية";
    expect(measureTextWidth(text)).toBe(13); // Hello(5) + space(1) + Arabic(7)
  });

  it("handles surrogate pairs correctly", () => {
    expect(measureTextWidth("💎")).toBe(2); // gem emoji
    expect(measureTextWidth("🧠")).toBe(2); // brain emoji
  });
});

describe("wrapText", () => {
  it("wraps text at word boundaries", () => {
    const lines = wrapText("hello world foo bar", 10);
    expect(lines).toEqual(["hello", "world foo", "bar"]);
  });

  it("returns single line when text fits", () => {
    expect(wrapText("short", 20)).toEqual(["short"]);
  });

  it("truncates words that exceed maxWidth", () => {
    const lines = wrapText("supercalifragilistic", 8);
    expect(lines[0]).toBe("super...");
  });

  it("handles narrow width", () => {
    const lines = wrapText("hello world", 4);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(measureTextWidth(line)).toBeLessThanOrEqual(4);
    }
  });

  it("handles empty string", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });

  it("handles multiple spaces", () => {
    const lines = wrapText("a   b   c", 5);
    expect(lines).toEqual(["a b c"]);
  });
});

describe("truncateText", () => {
  it("truncates long text with ellipsis", () => {
    expect(truncateText("hello world", 8)).toBe("hello...");
  });

  it("returns full text when it fits", () => {
    expect(truncateText("short", 20)).toBe("short");
  });

  it("handles exact fit", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("handles custom ellipsis", () => {
    expect(truncateText("hello world", 7, "..")).toBe("hello..");
  });

  it("handles full-width chars in truncation", () => {
    const text = "中文测试"; // 4 CJK chars = 8 width
    expect(truncateText(text, 6)).toBe("中..."); // 2 + 3 = 5, fits in 6
  });

  it("handles emoji in truncation", () => {
    const text = "😀😀😀"; // 3 emojis = 6 width
    // With maxWidth=4, even one emoji (2) + ellipsis (3) = 5 > 4,
    // so only ellipsis (3) fits.
    expect(truncateText(text, 4)).toBe("...");
    expect(measureTextWidth(truncateText(text, 4))).toBeLessThanOrEqual(4);
  });

  it("returns empty string for maxWidth 0", () => {
    expect(truncateText("hello", 0)).toBe("");
  });

  it("handles long paths", () => {
    const path = "/home/user/projects/my-awesome-project/src/components/ui/button.tsx";
    const truncated = truncateText(path, 40);
    expect(measureTextWidth(truncated)).toBeLessThanOrEqual(40);
    expect(truncated.endsWith("...")).toBe(true);
  });

  it("handles long model names", () => {
    const name = "anthropic/claude-3-5-sonnet-20241022-v2:0";
    const truncated = truncateText(name, 25);
    expect(measureTextWidth(truncated)).toBeLessThanOrEqual(25);
  });
});
