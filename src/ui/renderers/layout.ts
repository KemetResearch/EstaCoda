// Terminal layout helpers.
// Handles Unicode width measurement, wrapping, and truncation.
// No ANSI logic here — width is measured on visible characters only.

export function measureTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCombiningChar(cp)) {
      continue;
    }
    if (isFullWidthChar(cp) || isEmoji(cp)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  if (text.length === 0) return [""];
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = "";

  for (const word of words) {
    const wordWidth = measureTextWidth(word);
    const lineWidth = measureTextWidth(currentLine);

    if (currentLine.length === 0) {
      if (wordWidth > maxWidth) {
        lines.push(truncateText(word, maxWidth));
      } else {
        currentLine = word;
      }
    } else if (lineWidth + 1 + wordWidth <= maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      if (wordWidth > maxWidth) {
        lines.push(truncateText(word, maxWidth));
        currentLine = "";
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

export function truncateText(
  text: string,
  maxWidth: number,
  ellipsis: string = "..."
): string {
  const ellipsisWidth = measureTextWidth(ellipsis);
  if (maxWidth <= 0) return "";
  if (maxWidth <= ellipsisWidth) return ellipsis.slice(0, maxWidth);
  if (measureTextWidth(text) <= maxWidth) return text;

  let width = 0;
  let result = "";

  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    let charWidth = 1;
    if (isFullWidthChar(cp) || isEmoji(cp)) charWidth = 2;
    if (isCombiningChar(cp)) charWidth = 0;

    if (width + charWidth + ellipsisWidth > maxWidth) {
      return result + ellipsis;
    }

    width += charWidth;
    result += ch;
  }

  return result;
}

function isCombiningChar(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

function isFullWidthChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}

function isEmoji(cp: number): boolean {
  return (
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x2600 && cp <= 0x26ff) ||
    (cp >= 0x2700 && cp <= 0x27bf)
  );
}
