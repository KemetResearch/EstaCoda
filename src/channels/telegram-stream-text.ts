export type TelegramStreamTextChunk = {
  visibleText: string;
  visibleCharCount: number;
  escapedHtml: string;
  escapedUtf16Length: number;
};

export type TelegramStreamTextSnapshot = {
  visibleText: string;
  visibleCharCount: number;
  escapedHtml: string;
  escapedUtf16Length: number;
};

export type TelegramStreamTextSanitizer = {
  append(delta: string): TelegramStreamTextChunk;
  snapshot(): TelegramStreamTextSnapshot;
  reset(): void;
};

type ThinkMode = "visible" | "hidden";

const OPEN_THINK_TAGS = [
  "<REASONING_SCRATCHPAD>",
  "<think>",
  "<reasoning>",
  "<THINKING>",
  "<thinking>",
  "<thought>"
];
const CLOSE_THINK_TAGS = [
  "</REASONING_SCRATCHPAD>",
  "</think>",
  "</reasoning>",
  "</THINKING>",
  "</thinking>",
  "</thought>"
];
const THINK_PREFIXES = Array.from(new Set(OPEN_THINK_TAGS.flatMap((tag) => prefixes(tag))));
const CLOSE_THINK_PREFIXES = Array.from(new Set(CLOSE_THINK_TAGS.flatMap((tag) => prefixes(tag))));
const MEDIA_MARKER = "media:";
const MEDIA_DIRECTIVE_LINE = /^[ \t]*MEDIA:[ \t]*\S+[^\r\n]*(?:\r?\n|$)/gimu;

export function createTelegramStreamTextSanitizer(): TelegramStreamTextSanitizer {
  let mode: ThinkMode = "visible";
  let pending = "";
  let mediaPending = "";
  let visibleText = "";

  function applyVisible(text: string): string {
    const stripped = filterMediaDirectives(text);
    visibleText += stripped;
    return stripped;
  }

  function filterMediaDirectives(text: string): string {
    const combined = mediaPending + text;
    mediaPending = "";

    const lastLineStart = combined.lastIndexOf("\n") + 1;
    const stableLines = combined.slice(0, lastLineStart);
    const tail = combined.slice(lastLineStart);
    let emitted = stripTelegramMediaDirectives(stableLines);

    if (isPossibleMediaDirectiveTail(tail)) {
      mediaPending = tail;
      return emitted;
    }

    emitted += stripTelegramMediaDirectives(tail);
    return emitted;
  }

  function process(input: string): string {
    const visibleBeforeInput = visibleText;
    let emitted = "";
    let cursor = 0;

    while (cursor < input.length) {
      const remaining = input.slice(cursor);

      if (mode === "hidden") {
        const closeTag = findEarliestTag(remaining, CLOSE_THINK_TAGS);
        if (closeTag !== undefined) {
          cursor += closeTag.index + closeTag.tag.length;
          mode = "visible";
          continue;
        }

        const hiddenTail = longestSuffixPrefix(remaining, CLOSE_THINK_PREFIXES);
        pending = hiddenTail;
        cursor = input.length;
        break;
      }

      const openTag = findEarliestOpenTag(input, cursor, visibleBeforeInput);
      const pendingOpenTail = openTag === undefined
        ? longestBoundarySuffixPrefix(input, cursor, THINK_PREFIXES, visibleBeforeInput)
        : "";
      const safeEnd = openTag !== undefined ? openTag.index : input.length - pendingOpenTail.length;

      if (safeEnd > cursor) {
        emitted += applyVisible(input.slice(cursor, safeEnd));
        cursor = safeEnd;
      }

      if (openTag !== undefined && cursor === openTag.index) {
        cursor = openTag.tagIndex + openTag.tag.length;
        mode = "hidden";
        pending = "";
        continue;
      }

      if (cursor < input.length) {
        pending = input.slice(cursor);
        cursor = input.length;
      }
    }

    return emitted;
  }

  return {
    append(delta) {
      const input = pending + delta;
      pending = "";
      const emitted = process(input);
      return textChunk(emitted);
    },
    snapshot() {
      return textSnapshot(visibleText);
    },
    reset() {
      mode = "visible";
      pending = "";
      mediaPending = "";
      visibleText = "";
    }
  };
}

export function escapeTelegramPartialHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function getUtf16Length(text: string): number {
  return text.length;
}

export function getVisibleCharCount(text: string): number {
  return Array.from(text).length;
}

export function escapedTelegramPartialHtmlExceedsLimit(text: string, maxUtf16Length: number): boolean {
  return getUtf16Length(escapeTelegramPartialHtml(text)) > maxUtf16Length;
}

export function stripTelegramMediaDirectives(text: string): string {
  return text.replace(MEDIA_DIRECTIVE_LINE, "");
}

function textChunk(visibleText: string): TelegramStreamTextChunk {
  const escapedHtml = escapeTelegramPartialHtml(visibleText);
  return {
    visibleText,
    visibleCharCount: getVisibleCharCount(visibleText),
    escapedHtml,
    escapedUtf16Length: getUtf16Length(escapedHtml)
  };
}

function textSnapshot(visibleText: string): TelegramStreamTextSnapshot {
  const escapedHtml = escapeTelegramPartialHtml(visibleText);
  return {
    visibleText,
    visibleCharCount: getVisibleCharCount(visibleText),
    escapedHtml,
    escapedUtf16Length: getUtf16Length(escapedHtml)
  };
}

function prefixes(value: string): string[] {
  const result: string[] = [];
  for (let index = 1; index < value.length; index += 1) {
    result.push(value.slice(0, index).toLowerCase());
  }
  return result;
}

function findEarliestTag(text: string, tags: readonly string[]): { index: number; tag: string } | undefined {
  const lower = text.toLowerCase();
  let earliest: { index: number; tag: string } | undefined;

  for (const tag of tags) {
    const index = lower.indexOf(tag.toLowerCase());
    if (index >= 0 && (earliest === undefined || index < earliest.index)) {
      earliest = { index, tag };
    }
  }

  return earliest;
}

function findEarliestOpenTag(
  text: string,
  start: number,
  precedingAccumulated: string
): { index: number; tagIndex: number; tag: string } | undefined {
  const lower = text.toLowerCase();
  let earliest: { index: number; tagIndex: number; tag: string } | undefined;

  for (const tag of OPEN_THINK_TAGS) {
    let searchIndex = start;
    const lowerTag = tag.toLowerCase();

    while (searchIndex < text.length) {
      const index = lower.indexOf(lowerTag, searchIndex);
      if (index < 0) {
        break;
      }

      const boundaryStart = getTagBoundaryStart(text, index, precedingAccumulated);
      if (
        (earliest === undefined || index < earliest.index)
        && boundaryStart !== undefined
      ) {
        earliest = { index: boundaryStart, tagIndex: index, tag };
        break;
      }

      searchIndex = index + 1;
    }
  }

  return earliest;
}

function longestBoundarySuffixPrefix(
  text: string,
  start: number,
  candidates: readonly string[],
  precedingAccumulated: string
): string {
  const suffix = longestSuffixPrefix(text.slice(start), candidates);
  if (suffix.length === 0) {
    return "";
  }

  const tagIndex = text.length - suffix.length;
  const boundaryStart = getTagBoundaryStart(text, tagIndex, precedingAccumulated);
  return boundaryStart === undefined ? "" : text.slice(boundaryStart);
}

function getTagBoundaryStart(text: string, tagIndex: number, precedingAccumulated: string): number | undefined {
  if (tagIndex === 0) {
    return isAccumulatedLineBoundary(precedingAccumulated) ? 0 : undefined;
  }

  const before = text.slice(0, tagIndex);
  const lastNewline = before.lastIndexOf("\n");
  if (lastNewline === -1) {
    return isAccumulatedLineBoundary(precedingAccumulated) && before.trim() === "" ? 0 : undefined;
  }

  return before.slice(lastNewline + 1).trim() === "" ? lastNewline + 1 : undefined;
}

function isAccumulatedLineBoundary(text: string): boolean {
  if (text.length === 0 || text.endsWith("\n")) {
    return true;
  }

  const lastNewline = text.lastIndexOf("\n");
  return text.slice(lastNewline + 1).trim() === "";
}

function longestSuffixPrefix(text: string, candidates: readonly string[]): string {
  const lower = text.toLowerCase();
  let longest = "";
  for (const candidate of candidates) {
    if (candidate.length > longest.length && lower.endsWith(candidate)) {
      longest = text.slice(text.length - candidate.length);
    }
  }
  return longest;
}

function isPossibleMediaDirectiveTail(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  const markerCandidate = text.replace(/^[ \t]*/, "").toLowerCase();
  return markerCandidate.length === 0
    || MEDIA_MARKER.startsWith(markerCandidate)
    || markerCandidate.startsWith(MEDIA_MARKER);
}
