import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { PasteInterceptor, createFilePasteReferenceStore, restorePastedNewlines } from "./paste-interceptor.js";

describe("PasteInterceptor", () => {
  it("passes through plain input unchanged", async () => {
    const interceptor = new PasteInterceptor();

    await expect(collect(interceptor, ["hello world"])).resolves.toBe("hello world");
    expect(interceptor.regions).toEqual([]);
  });

  it("compresses multiline bracketed paste for readline display", async () => {
    const interceptor = new PasteInterceptor();

    await expect(collect(interceptor, ["\x1b[200~line 1\nline 2\x1b[201~"])).resolves.toBe("line 1 ↵ line 2");
    expect(interceptor.regions).toEqual([{ original: "line 1\nline 2", displayed: "line 1 ↵ line 2" }]);
    expect(interceptor.restore("line 1 ↵ line 2")).toBe("line 1\nline 2");
  });

  it("preserves typed prefix and suffix during reconstruction", async () => {
    const interceptor = new PasteInterceptor();
    const displayed = await collect(interceptor, ["prefix \x1b[200~a\nb\x1b[201~ suffix"]);

    expect(displayed).toBe("prefix a ↵ b suffix");
    expect(interceptor.restore(displayed)).toBe("prefix a\nb suffix");
  });

  it("reconstructs multiple paste regions in order", async () => {
    const interceptor = new PasteInterceptor();
    const displayed = await collect(interceptor, [
      "one \x1b[200~a\nb\x1b[201~ two \x1b[200~c\nd\x1b[201~ three",
    ]);

    expect(displayed).toBe("one a ↵ b two c ↵ d three");
    expect(interceptor.restore(displayed)).toBe("one a\nb two c\nd three");
  });

  it("handles split bracket markers and split UTF-8 safely", async () => {
    const interceptor = new PasteInterceptor();
    const arabic = Buffer.from("سطر 1\nسطر 2");
    const chunks = [
      Buffer.from("\x1b[2"),
      Buffer.from("00~"),
      arabic.subarray(0, 5),
      arabic.subarray(5),
      Buffer.from("\x1b[20"),
      Buffer.from("1~"),
    ];

    const displayed = await collectBuffers(interceptor, chunks);
    expect(displayed).toBe("سطر 1 ↵ سطر 2");
    expect(interceptor.restore(displayed)).toBe("سطر 1\nسطر 2");
  });

  it("flushes an unterminated paste on stream end", async () => {
    const interceptor = new PasteInterceptor();

    const displayed = await collect(interceptor, ["\x1b[200~line 1\nline 2"]);
    expect(displayed).toBe("line 1 ↵ line 2");
    expect(interceptor.restore(displayed)).toBe("line 1\nline 2");
  });

  it("flushes an unterminated paste after the timeout", async () => {
    const interceptor = new PasteInterceptor({ unterminatedPasteTimeoutMs: 5 });
    const source = new PassThrough();
    let result = "";
    interceptor.on("data", (chunk) => {
      result += String(chunk);
    });
    source.pipe(interceptor);

    source.write("\x1b[200~line 1\nline 2");
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.end();
    await new Promise<void>((resolve) => interceptor.on("end", resolve));

    expect(result).toBe("line 1 ↵ line 2");
    expect(interceptor.restore(result)).toBe("line 1\nline 2");
  });

  it("suppresses a late closing marker after a timeout flush", async () => {
    const interceptor = new PasteInterceptor({ unterminatedPasteTimeoutMs: 5 });
    const source = new PassThrough();
    let result = "";
    interceptor.on("data", (chunk) => {
      result += String(chunk);
    });
    source.pipe(interceptor);

    source.write("\x1b[200~line 1\nline 2");
    await new Promise((resolve) => setTimeout(resolve, 20));
    source.end("\x1b[201~");
    await new Promise<void>((resolve) => interceptor.on("end", resolve));

    expect(result).toBe("line 1 ↵ line 2");
    expect(interceptor.restore(result)).toBe("line 1\nline 2");
  });

  it("does not rewrite manually typed marker text without a tracked paste region", () => {
    expect(restorePastedNewlines("a ↵ b")).toBe("a ↵ b");
  });

  it("uses compact file-backed references for multiline pasted text when a store is configured", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "estacoda-paste-reference-"));
    try {
      const interceptor = new PasteInterceptor({
        referenceStore: createFilePasteReferenceStore({
          directory: tempDir,
          now: () => new Date("2026-06-01T14:00:06Z"),
        }),
      });

      const displayed = await collect(interceptor, ["\x1b[200~line 1\nline 2\x1b[201~"]);

      expect(displayed).toMatch(/^\[Pasted text #\d+: 2 lines → .+paste_\d+_\d{6}_[a-f0-9]{8}\.txt\]$/u);
      const path = displayed.match(/→ (.*)\]$/u)?.[1];
      expect(path).toBeDefined();
      expect(path).toContain(tempDir);
      await expect(readFile(path!, "utf8")).resolves.toBe("line 1\nline 2");
      expect(interceptor.restore(displayed)).toBe("line 1\nline 2");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses compact file-backed references for large single-line pasted text", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "estacoda-paste-reference-"));
    try {
      const original = "x".repeat(20);
      const interceptor = new PasteInterceptor({
        referenceStore: createFilePasteReferenceStore({ directory: tempDir }),
        referenceThresholdChars: 10,
      });

      const displayed = await collect(interceptor, [`\x1b[200~${original}\x1b[201~`]);

      expect(displayed).toMatch(/^\[Pasted text #\d+: 1 line → /u);
      const path = displayed.match(/→ (.*)\]$/u)?.[1];
      expect(path).toBeDefined();
      await expect(readFile(path!, "utf8")).resolves.toBe(original);
      expect(interceptor.restore(displayed)).toBe(original);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps small single-line pastes inline even when a store is configured", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "estacoda-paste-reference-"));
    try {
      const interceptor = new PasteInterceptor({
        referenceStore: createFilePasteReferenceStore({ directory: tempDir }),
        referenceThresholdChars: 10,
      });

      const displayed = await collect(interceptor, ["\x1b[200~small\x1b[201~"]);

      expect(displayed).toBe("small");
      expect(interceptor.restore(displayed)).toBe("small");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("generates unique paste references for multiple large paste regions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "estacoda-paste-reference-"));
    try {
      const interceptor = new PasteInterceptor({
        referenceStore: createFilePasteReferenceStore({
          directory: tempDir,
          now: () => new Date("2026-06-01T14:00:06Z"),
        }),
      });

      const displayed = await collect(interceptor, [
        "\x1b[200~a\nb\x1b[201~ and \x1b[200~c\nd\x1b[201~",
      ]);
      const paths = [...displayed.matchAll(/→ (.*?)\]/gu)].map((match) => match[1]);

      expect(paths).toHaveLength(2);
      expect(new Set(paths).size).toBe(2);
      await expect(readFile(paths[0]!, "utf8")).resolves.toBe("a\nb");
      await expect(readFile(paths[1]!, "utf8")).resolves.toBe("c\nd");
      expect(interceptor.restore(displayed)).toBe("a\nb and c\nd");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function collect(interceptor: PasteInterceptor, chunks: string[]): Promise<string> {
  return await collectBuffers(interceptor, chunks.map((chunk) => Buffer.from(chunk)));
}

async function collectBuffers(interceptor: PasteInterceptor, chunks: Buffer[]): Promise<string> {
  const source = Readable.from(chunks);
  source.pipe(interceptor);
  let result = "";
  interceptor.on("data", (chunk) => {
    result += String(chunk);
  });
  await new Promise<void>((resolve) => interceptor.on("end", resolve));
  return result;
}
