import { describe, expect, it } from "vitest";
import {
  createTelegramStreamTextSanitizer,
  escapeTelegramPartialHtml,
  escapedTelegramPartialHtmlExceedsLimit,
  getUtf16Length,
  stripTelegramMediaDirectives
} from "./telegram-stream-text.js";

describe("Telegram stream text sanitizer", () => {
  it("strips full think blocks", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("visible\n<think>hidden</think> text");

    expect(chunk.visibleText).toBe("visible\n text");
    expect(sanitizer.snapshot().visibleText).toBe("visible\n text");
  });

  it("strips lowercase thinking blocks", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("<thinking>hidden</thinking>visible");

    expect(chunk.visibleText).toBe("visible");
    expect(sanitizer.snapshot().visibleText).toBe("visible");
  });

  it("strips uppercase thinking blocks", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("<THINKING>hidden</THINKING>visible");

    expect(chunk.visibleText).toBe("visible");
    expect(sanitizer.snapshot().visibleText).toBe("visible");
  });

  it("strips split think opening tags", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("<thi").visibleText).toBe("");
    expect(sanitizer.append("nk>hidden</think> world").visibleText).toBe(" world");
    expect(sanitizer.snapshot().visibleText).toBe(" world");
  });

  it("strips split think opening tags after leading whitespace", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("  <thi").visibleText).toBe("");
    expect(sanitizer.append("nk>hidden</think> visible").visibleText).toBe(" visible");
    expect(sanitizer.snapshot().visibleText).toBe(" visible");
  });

  it("strips split think opening tags after newline-leading whitespace", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("before\n  <thi").visibleText).toBe("before\n");
    expect(sanitizer.append("nk>hidden</think> visible").visibleText).toBe(" visible");
    expect(sanitizer.snapshot().visibleText).toBe("before\n visible");
  });

  it("resumes visible text after split think closing tags", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("<think>hidden</thi").visibleText).toBe("");
    expect(sanitizer.append("nk>visible").visibleText).toBe("visible");
    expect(sanitizer.snapshot().visibleText).toBe("visible");
  });

  it("does not leak partial think candidates", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("before\n<think").visibleText).toBe("before\n");
    expect(sanitizer.snapshot().visibleText).toBe("before\n");
  });

  it("emits non-think angle bracket prose once proven normal", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("a <thi").visibleText).toBe("a <thi");
    expect(sanitizer.append("X value").visibleText).toBe("X value");
    expect(sanitizer.snapshot().escapedHtml).toBe("a &lt;thiX value");
  });

  it("strips multiple think blocks", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    sanitizer.append("<think>one</think>b\n<think>two</think> c");

    expect(sanitizer.snapshot().visibleText).toBe("b\n c");
  });

  it("keeps unmatched open think blocks hidden", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("<think>hidden").visibleText).toBe("");
    expect(sanitizer.append(" still hidden").visibleText).toBe("");
    expect(sanitizer.snapshot().visibleText).toBe("");
  });

  it("preserves prose mentions of think tags", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("the <think> tag");

    expect(chunk.visibleText).toBe("the <think> tag");
    expect(sanitizer.snapshot().visibleText).toBe("the <think> tag");
  });

  it("preserves mid-sentence think blocks as prose", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("hello <think>hidden</think> world");

    expect(chunk.visibleText).toBe("hello <think>hidden</think> world");
    expect(sanitizer.snapshot().visibleText).toBe("hello <think>hidden</think> world");
  });

  it("strips media directives without counting them as visible", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("MEDIA:/tmp/file.png\nvisible");

    expect(chunk.visibleText).toBe("visible");
    expect(chunk.visibleCharCount).toBe(7);
    expect(sanitizer.snapshot().visibleText).toBe("visible");
  });

  it("strips media directives with a space after the marker", () => {
    expect(stripTelegramMediaDirectives("MEDIA: /tmp/file.png\nnext")).toBe("next");
  });

  it("strips split media directives without leaking prefixes", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    expect(sanitizer.append("ME").visibleText).toBe("");
    expect(sanitizer.append("DIA:/tmp/file.png\nvisible").visibleText).toBe("visible");
    expect(sanitizer.snapshot().visibleText).toBe("visible");
  });

  it("preserves normal prose containing media", () => {
    const text = "This media file is useful. Not a MEDIA directive in prose.";

    expect(stripTelegramMediaDirectives(text)).toBe(text);
  });

  it("escapes partial HTML angle brackets safely", () => {
    expect(escapeTelegramPartialHtml("a < b > c")).toBe("a &lt; b &gt; c");
  });

  it("escapes ampersands safely", () => {
    expect(escapeTelegramPartialHtml("a & b")).toBe("a &amp; b");
  });

  it("computes visible character count after filtering", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("🙂\n<think>hidden</think>a");

    expect(chunk.visibleText).toBe("🙂\na");
    expect(chunk.visibleCharCount).toBe(3);
  });

  it("computes escaped UTF-16 length after escaping", () => {
    const sanitizer = createTelegramStreamTextSanitizer();

    const chunk = sanitizer.append("🙂 & <tag>");

    expect(chunk.escapedHtml).toBe("🙂 &amp; &lt;tag&gt;");
    expect(chunk.escapedUtf16Length).toBe(getUtf16Length("🙂 &amp; &lt;tag&gt;"));
  });

  it("detects escaped HTML expansion over a supplied limit", () => {
    expect(escapedTelegramPartialHtmlExceedsLimit("<>&", 10)).toBe(true);
    expect(escapedTelegramPartialHtmlExceedsLimit("abc", 10)).toBe(false);
  });

  it("reset clears sanitizer state", () => {
    const sanitizer = createTelegramStreamTextSanitizer();
    sanitizer.append("visible\n<think>hidden");

    sanitizer.reset();
    const chunk = sanitizer.append(" shown");

    expect(chunk.visibleText).toBe(" shown");
    expect(sanitizer.snapshot().visibleText).toBe(" shown");
  });
});
