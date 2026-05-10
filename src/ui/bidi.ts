// Bidi/LTR isolation helpers for technical tokens embedded in Arabic text.
// Keep this minimal — no full bidi framework.

export const LRI = "\u2066";
export const PDI = "\u2069";

/**
 * Wraps a value in Left-to-Right Isolate (LRI) and Pop Directional Isolate (PDI)
 * so it stays LTR-stable when embedded in RTL (Arabic) text.
 */
export function isolateLtr(value: string): string {
  return `${LRI}${value}${PDI}`;
}
