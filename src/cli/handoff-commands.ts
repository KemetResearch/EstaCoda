import { join } from "node:path";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { ViewModel } from "../contracts/view-model.js";
import {
  buildHandoffHelpViewModel,
  buildHandoffTelegramViewModel,
  buildHandoffListViewModel,
  buildNoActiveSessionForHandoffViewModel,
} from "./handoff-view-models.js";

export type HandoffRenderer = (viewModel: ViewModel) => string;

export type HandoffCommandInput = {
  args: string[];
  homeDir: string;
  runtime?: { sessionId: string };
};

export async function runHandoffCommand(
  input: HandoffCommandInput,
  renderer: HandoffRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const [subcommand, ...rest] = input.args;

  if (subcommand === "telegram") {
    const runtime = input.runtime;
    if (runtime === undefined) {
      const viewModel = buildNoActiveSessionForHandoffViewModel({
        message: "No active session. Start an interactive session first, then run: estacoda handoff telegram",
      });
      return { ok: false, output: renderer(viewModel) };
    }

    const { FileHandoffStore } = await import("../channels/handoff-store.js");
    const homeDir = input.homeDir;
    const store = new FileHandoffStore({ path: join(homeDir, ".estacoda", "handoff-codes.json") });
    const handoff = await store.create({
      sessionId: runtime.sessionId,
      surfaceType: "telegram",
      ttlMinutes: 10,
    });

    const viewModel = buildHandoffTelegramViewModel({
      code: handoff.code,
      sessionId: runtime.sessionId,
      expiresAt: handoff.expiresAt,
      ttlMinutes: 10,
    });
    return { ok: true, output: renderer(viewModel) };
  }

  if (subcommand === "list") {
    const { FileHandoffStore } = await import("../channels/handoff-store.js");
    const homeDir = input.homeDir;
    const store = new FileHandoffStore({ path: join(homeDir, ".estacoda", "handoff-codes.json") });
    const codes = await store.list();
    const active = codes.filter((c) => !c.redeemed && new Date(c.expiresAt).getTime() > Date.now());
    const viewModel = buildHandoffListViewModel({ activeCodes: active });
    return { ok: true, output: renderer(viewModel) };
  }

  return { ok: true, output: renderer(buildHandoffHelpViewModel()) };
}
