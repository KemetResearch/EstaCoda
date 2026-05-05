// v0.95 Handoff ViewModel Builders
// Pure factory functions. No formatting, ANSI, terminal-width, or rendering logic.

import type { HandoffCode } from "../channels/handoff-store.js";
import type { ViewModel } from "../contracts/view-model.js";
import {
  buildCommandResultViewModel,
  buildKeyValueBlockViewModel,
  buildListViewModel,
  buildWarningErrorViewModel,
  buildPlainFallbackViewModel,
  kv,
  listItem,
} from "../ui/view-models/builders.js";

// ─────────────────────────────────────────────────────────────
// Handoff Help
// ─────────────────────────────────────────────────────────────

export function buildHandoffHelpViewModel(): ViewModel {
  return buildCommandResultViewModel({
    ok: true,
    title: "EstaCoda handoff",
    blocks: [
      buildListViewModel({
        items: [
          listItem("estacoda handoff telegram  Generate a handoff code for Telegram"),
          listItem("estacoda handoff list      List active handoff codes"),
        ],
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────
// Handoff Telegram
// ─────────────────────────────────────────────────────────────

export interface HandoffTelegramData {
  readonly code: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly ttlMinutes: number;
}

export function buildHandoffTelegramViewModel(data: HandoffTelegramData): ViewModel {
  return buildCommandResultViewModel({
    ok: true,
    title: "Handoff code generated",
    blocks: [
      buildKeyValueBlockViewModel({
        entries: [
          kv("Handoff code for Telegram", data.code),
          kv("Session", data.sessionId),
          kv("Expires", data.expiresAt),
        ],
      }),
      buildPlainFallbackViewModel({
        lines: [
          "",
          "To attach a Telegram chat to this session, send the following in Telegram:",
          `  /attach ${data.code}`,
          "",
          `This code is single-use and expires in ${data.ttlMinutes} minutes.`,
        ],
      }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────
// Handoff List
// ─────────────────────────────────────────────────────────────

export interface HandoffListData {
  readonly activeCodes: readonly HandoffCode[];
}

export function buildHandoffListViewModel(data: HandoffListData): ViewModel {
  if (data.activeCodes.length === 0) {
    return buildCommandResultViewModel({
      ok: true,
      title: "Handoff codes",
      blocks: [
        buildPlainFallbackViewModel({ lines: ["No active handoff codes."] }),
      ],
    });
  }

  const items = data.activeCodes.map((c) =>
    listItem(`${c.code} → ${c.sessionId} (expires ${c.expiresAt})`)
  );

  return buildCommandResultViewModel({
    ok: true,
    title: `Active handoff codes: ${data.activeCodes.length}`,
    blocks: [buildListViewModel({ items })],
  });
}

// ─────────────────────────────────────────────────────────────
// Handoff Errors
// ─────────────────────────────────────────────────────────────

export interface NoActiveSessionForHandoffData {
  readonly message: string;
}

export function buildNoActiveSessionForHandoffViewModel(data: NoActiveSessionForHandoffData): ViewModel {
  return buildCommandResultViewModel({
    ok: false,
    title: "No active session",
    blocks: [
      buildWarningErrorViewModel({
        severity: "warn",
        title: "No session",
        message: data.message,
      }),
    ],
  });
}
