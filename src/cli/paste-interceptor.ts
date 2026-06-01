import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Transform, type TransformCallback } from "node:stream";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const PASTE_NEWLINE_MARKER = " ↵ ";
const NEWLINE_PATTERN = /\r\n|\r|\n/gu;
const NEWLINE_DETECT_PATTERN = /\r\n|\r|\n/u;
const DEFAULT_REFERENCE_THRESHOLD_CHARS = 4_096;
let nextGlobalPasteReferenceId = 1;

export interface PasteRegion {
  readonly original: string;
  readonly displayed: string;
}

export interface PasteReference {
  readonly id: number;
  readonly path: string;
}

export interface PasteReferenceStore {
  create(original: string): PasteReference;
}

export interface PasteInterceptorOptions {
  readonly onPaste?: (original: string, displayed: string) => void;
  readonly referenceStore?: PasteReferenceStore;
  readonly referenceThresholdChars?: number;
  readonly unterminatedPasteTimeoutMs?: number;
}

export class PasteInterceptor extends Transform {
  readonly #decoder = new StringDecoder("utf8");
  readonly #onPaste?: (original: string, displayed: string) => void;
  readonly #referenceStore?: PasteReferenceStore;
  readonly #referenceThresholdChars: number;
  readonly #unterminatedPasteTimeoutMs: number;
  readonly #regions: PasteRegion[] = [];
  #inPaste = false;
  #pasteBuffer = "";
  #controlBuffer = "";
  #unterminatedTimer?: ReturnType<typeof setTimeout>;
  #ignoreNextPasteEnd = false;

  constructor(options: PasteInterceptorOptions = {}) {
    super();
    this.#onPaste = options.onPaste;
    this.#referenceStore = options.referenceStore;
    this.#referenceThresholdChars = options.referenceThresholdChars ?? DEFAULT_REFERENCE_THRESHOLD_CHARS;
    this.#unterminatedPasteTimeoutMs = options.unterminatedPasteTimeoutMs ?? 5_000;
  }

  get regions(): readonly PasteRegion[] {
    return this.#regions;
  }

  restore(answer: string): string {
    return restorePastedNewlines(answer, this.#regions);
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#processText(this.#decoder.write(chunk));
    callback();
  }

  _flush(callback: TransformCallback): void {
    const remaining = this.#decoder.end();
    if (remaining.length > 0) {
      this.#processText(remaining);
    }
    if (this.#controlBuffer.length > 0) {
      if (this.#inPaste) {
        this.#pasteBuffer += this.#controlBuffer;
      } else {
        this.push(this.#controlBuffer);
      }
      this.#controlBuffer = "";
    }
    if (this.#inPaste) {
      this.#finishPaste();
    }
    this.#clearUnterminatedTimer();
    callback();
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.#clearUnterminatedTimer();
    callback(error);
  }

  #processText(text: string): void {
    for (const char of text) {
      if (this.#inPaste) {
        this.#processPasteChar(char);
      } else {
        this.#processPlainChar(char);
      }
    }
  }

  #processPlainChar(char: string): void {
    if (this.#controlBuffer.length === 0 && char !== "\x1b") {
      this.push(char);
      return;
    }

    this.#controlBuffer += char;
    if (BRACKETED_PASTE_START === this.#controlBuffer) {
      this.#inPaste = true;
      this.#pasteBuffer = "";
      this.#controlBuffer = "";
      this.#startUnterminatedTimer();
      return;
    }
    if (BRACKETED_PASTE_END === this.#controlBuffer) {
      if (!this.#ignoreNextPasteEnd) {
        this.push(this.#controlBuffer);
      }
      this.#ignoreNextPasteEnd = false;
      this.#controlBuffer = "";
      return;
    }
    if (BRACKETED_PASTE_START.startsWith(this.#controlBuffer)) {
      return;
    }
    if (this.#ignoreNextPasteEnd && BRACKETED_PASTE_END.startsWith(this.#controlBuffer)) {
      return;
    }

    this.push(this.#controlBuffer);
    this.#ignoreNextPasteEnd = false;
    this.#controlBuffer = "";
  }

  #processPasteChar(char: string): void {
    if (this.#controlBuffer.length === 0 && char !== "\x1b") {
      this.#pasteBuffer += char;
      this.#startUnterminatedTimer();
      return;
    }

    this.#controlBuffer += char;
    if (BRACKETED_PASTE_END === this.#controlBuffer) {
      this.#controlBuffer = "";
      this.#finishPaste();
      return;
    }
    if (BRACKETED_PASTE_END.startsWith(this.#controlBuffer)) {
      return;
    }

    this.#pasteBuffer += this.#controlBuffer;
    this.#controlBuffer = "";
    this.#startUnterminatedTimer();
  }

  #finishPaste(): void {
    this.#clearUnterminatedTimer();
    this.#inPaste = false;
    const original = this.#pasteBuffer;
    this.#pasteBuffer = "";
    const displayed = displayPastedText(original, {
      referenceStore: this.#referenceStore,
      referenceThresholdChars: this.#referenceThresholdChars,
    });
    this.#regions.push({ original, displayed });
    this.#onPaste?.(original, displayed);
    this.push(displayed);
  }

  #startUnterminatedTimer(): void {
    this.#clearUnterminatedTimer();
    if (this.#unterminatedPasteTimeoutMs <= 0) {
      return;
    }
    this.#unterminatedTimer = setTimeout(() => {
      if (this.#controlBuffer.length > 0) {
        this.#pasteBuffer += this.#controlBuffer;
        this.#controlBuffer = "";
      }
      if (this.#inPaste) {
        this.#ignoreNextPasteEnd = true;
        this.#finishPaste();
      }
    }, this.#unterminatedPasteTimeoutMs);
    this.#unterminatedTimer.unref?.();
  }

  #clearUnterminatedTimer(): void {
    if (this.#unterminatedTimer !== undefined) {
      clearTimeout(this.#unterminatedTimer);
      this.#unterminatedTimer = undefined;
    }
  }
}

export function displayPastedText(
  original: string,
  options: {
    readonly referenceStore?: PasteReferenceStore;
    readonly referenceThresholdChars?: number;
  } = {}
): string {
  if (shouldUsePasteReference(original, options.referenceThresholdChars ?? DEFAULT_REFERENCE_THRESHOLD_CHARS)) {
    const reference = options.referenceStore?.create(original);
    if (reference !== undefined) {
      return formatPasteReference(original, reference);
    }
  }
  return original.replace(NEWLINE_PATTERN, PASTE_NEWLINE_MARKER);
}

export function restorePastedNewlines(answer: string, regions: readonly PasteRegion[] = []): string {
  let restored = answer;
  let searchFrom = 0;

  for (const region of regions) {
    if (region.displayed.length === 0) {
      continue;
    }
    const index = restored.indexOf(region.displayed, searchFrom);
    if (index === -1) {
      continue;
    }
    restored = `${restored.slice(0, index)}${region.original}${restored.slice(index + region.displayed.length)}`;
    searchFrom = index + region.original.length;
  }

  return restored;
}

export function enableBracketedPaste(output: NodeJS.WritableStream): void {
  output.write("\x1b[?2004h");
}

export function disableBracketedPaste(output: NodeJS.WritableStream): void {
  output.write("\x1b[?2004l");
}

export function createFilePasteReferenceStore(options: {
  readonly directory: string;
  readonly now?: () => Date;
}): PasteReferenceStore {
  return {
    create(original: string): PasteReference {
      const id = nextGlobalPasteReferenceId;
      nextGlobalPasteReferenceId += 1;
      const timestamp = timestampForPastePath(options.now?.() ?? new Date());
      const uniqueSuffix = randomUUID().slice(0, 8);
      const path = join(options.directory, `paste_${id}_${timestamp}_${uniqueSuffix}.txt`);
      mkdirSync(options.directory, { recursive: true });
      writeFileSync(path, original, "utf8");
      return { id, path };
    },
  };
}

function shouldUsePasteReference(original: string, thresholdChars: number): boolean {
  return NEWLINE_DETECT_PATTERN.test(original) || original.length > thresholdChars;
}

function formatPasteReference(original: string, reference: PasteReference): string {
  const lines = lineCount(original);
  return `[Pasted text #${reference.id}: ${lines} ${lines === 1 ? "line" : "lines"} → ${reference.path}]`;
}

function lineCount(value: string): number {
  return value.split(NEWLINE_PATTERN).length;
}

function timestampForPastePath(value: Date): string {
  return [
    String(value.getHours()).padStart(2, "0"),
    String(value.getMinutes()).padStart(2, "0"),
    String(value.getSeconds()).padStart(2, "0"),
  ].join("");
}
