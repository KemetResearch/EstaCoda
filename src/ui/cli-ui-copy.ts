// v0.95 UI Chrome Copy Boundary
// Small, focused copy map for new interactive chrome labels only.
// Do not use this for legacy command output — keep those English.

import { isolateLtr } from "./bidi.js";

export type UiLocale = "en" | "ar";

export interface CliUiChromeCopy {
  // Assistant card (Pass 6+)
  readonly assistantCardTitle: string;
  readonly assistantCardTitleUnicode: string;
  readonly assistantCardTitleAscii: string;

  // Status rail labels (Pass 7+)
  readonly model: string;
  readonly readiness: string;
  readonly idle: string;
  readonly running: string;
  readonly blocked: string;
  readonly error: string;

  // Shortcut rail (Pass 7+)
  readonly shortcuts: string;

  // Active turn spinner (Pass 9+)
  readonly thinking: string;
  readonly routing: string;
  readonly provider: string;
  readonly tool: string;
  readonly finalizing: string;

  // Permission card (Pass 10+)
  readonly permissionRequired: string;

  // Slash menu (Pass 13+)
  readonly commands: string;
  readonly typeToFilter: string;
}

const en: CliUiChromeCopy = {
  assistantCardTitle: "EstaCoda",
  assistantCardTitleUnicode: "𓂀 EstaCoda",
  assistantCardTitleAscii: "* EstaCoda",

  model: "model",
  readiness: "readiness",
  idle: "idle",
  running: "running",
  blocked: "blocked",
  error: "error",

  shortcuts: "/help · /tools · /model · /status · Ctrl+C exit",

  thinking: "contemplating",
  routing: "plotting",
  provider: "scribbling",
  tool: "tinkering",
  finalizing: "polishing",

  permissionRequired: "Permission required",

  commands: "Commands",
  typeToFilter: "Type / then a command. Keep typing to filter.",
};

const ar: CliUiChromeCopy = {
  assistantCardTitle: "إستاكودا",
  assistantCardTitleUnicode: "𓂀 إستاكودا",
  assistantCardTitleAscii: "* إستاكودا",

  model: "النموذج",
  readiness: "الجاهزية",
  idle: "خامل",
  running: "شغال",
  blocked: "محجوز",
  error: "خطأ",

  // Technical tokens inside Arabic shortcuts must stay LTR-stable
  shortcuts: `${isolateLtr("/help")} · ${isolateLtr("/tools")} · ${isolateLtr("/model")} · ${isolateLtr("/status")} · ${isolateLtr("Ctrl+C")} خروج`,

  thinking: "بفكر",
  routing: "بحدد",
  provider: "بكتب",
  tool: "شغال",
  finalizing: "بخلص",

  permissionRequired: "مطلوب إذن",

  commands: "الأوامر",
  typeToFilter: "اكتب / ثم أمر. استمر في الكتابة للتصفية.",
};

export const cliUiChromeCopy: Record<UiLocale, CliUiChromeCopy> = {
  en,
  ar,
};

export function chromeCopy(locale: UiLocale): CliUiChromeCopy {
  return cliUiChromeCopy[locale] ?? en;
}
