// Placeholder UI contract types for v0.95 rendering pipeline.
// Expanded in Phases 3-6.

export type UiMode = "plain" | "standard";
export type UiTheme = "light" | "dark";
export type SkinName = "kemetBlue";

export interface TerminalCapabilities {
  isTTY: boolean;
  supportsColor: boolean;
  supportsTrueColor: boolean;
  supportsUnicode: boolean;
  supportsEmoji: boolean;
  terminalWidth: number;
  isDumb: boolean;
  isCI: boolean;
  supportsAnimation: boolean;
}

export interface ResolvedTokens {
  // To be defined in Phase 3.
  mode: UiMode;
  theme: UiTheme;
  skin: SkinName;
}

export interface Renderer {
  // To be defined in Phase 5-6.
  readonly capabilities: TerminalCapabilities;
  readonly tokens: ResolvedTokens;
}

export interface SurfaceAdapter {
  // To be defined in Phase 10.
  deliver(text: string): Promise<void>;
}
