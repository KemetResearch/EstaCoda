// v0.95 Session Renderer
// Creates a ViewModel renderer for the CLI session loop.
// Falls back to plain renderer when capabilities restrict color.

import type { TerminalCapabilities } from "../contracts/ui.js";
import type { ViewModel } from "../contracts/view-model.js";
import type { ResolvedTokens } from "../contracts/ui-tokens.js";
import { detectTerminalCapabilities } from "../ui/capabilities.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import { StandardRenderer } from "../ui/renderers/standard-renderer.js";
import { resolveTokens } from "../theme/token-resolver.js";

export interface SessionRenderer {
  render(viewModel: ViewModel): string;
  tokens: ResolvedTokens;
  capabilities: TerminalCapabilities;
}

export interface CreateSessionRendererOptions {
  output?: NodeJS.WritableStream;
  capabilities?: TerminalCapabilities;
  theme?: "light" | "dark";
  mode?: "standard" | "plain";
}

export function createSessionRenderer(options: CreateSessionRendererOptions = {}): SessionRenderer {
  const caps = options.capabilities ?? detectTerminalCapabilities({
    stream: options.output as { isTTY?: boolean; columns?: number } | undefined
  });

  const explicitPlain = options.mode === "plain";
  const shouldUsePlain =
    explicitPlain ||
    !caps.isTTY ||
    caps.isCI ||
    caps.isDumb ||
    !caps.supportsColor;

  const tokens = resolveTokens(shouldUsePlain ? "plain" : "standard", options.theme ?? "dark", "kemetBlue");

  if (shouldUsePlain) {
    return { render: renderPlain, tokens, capabilities: caps };
  }

  const renderer = new StandardRenderer({ tokens, capabilities: caps });
  return { render: (vm) => renderer.render(vm), tokens, capabilities: caps };
}
