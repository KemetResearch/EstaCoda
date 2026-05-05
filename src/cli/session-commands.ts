import { join } from "node:path";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { ViewModel } from "../contracts/view-model.js";
import type { SessionRecord } from "../contracts/session.js";
import {
  buildSessionsHelpViewModel,
  buildSessionsListViewModel,
  buildSessionShowViewModel,
  buildSessionCurrentViewModel,
  buildSessionAttachViewModel,
  buildSessionDetachViewModel,
  buildSessionNotFoundViewModel,
  buildNoActiveSessionViewModel,
  buildInvalidSurfaceViewModel,
  buildSessionUsageErrorViewModel,
} from "./session-view-models.js";

export type SessionRenderer = (viewModel: ViewModel) => string;

export type SessionCommandInput = {
  args: string[];
  homeDir: string;
  runtime?: { sessionId: string };
};

const VALID_SURFACES = ["cli", "telegram", "discord", "whatsapp", "email"] as const;

export async function runSessionsCommand(
  input: SessionCommandInput,
  renderer: SessionRenderer = renderPlain
): Promise<{ ok: boolean; output: string }> {
  const [subcommand, ...rest] = input.args;
  const homeDir = input.homeDir;
  const dbPath = join(homeDir, ".estacoda", "sessions.sqlite");

  if (subcommand === "list" || subcommand === undefined) {
    const { SQLiteSessionDB } = await import("../session/sqlite-session-db.js");
    const db = new SQLiteSessionDB({ path: dbPath });
    const { FileSurfacePointerStore } = await import("../channels/surface-pointer-store.js");
    const pointerStore = new FileSurfacePointerStore({ path: join(homeDir, ".estacoda", "surface-pointers.json") });
    try {
      const sessions = await db.listSessions("default");
      const pointers = await pointerStore.listPointers();
      const entries = sessions.slice(0, 20).map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        attachments: pointers
          .filter((p) => p.record.sessionId === s.id)
          .map((p) => `${p.surfaceType}:${p.surfaceId}`),
      }));
      const viewModel = buildSessionsListViewModel({ sessions: entries });
      return { ok: true, output: renderer(viewModel) };
    } finally {
      await db.close();
    }
  }

  if (subcommand === "show") {
    const sessionId = rest[0];
    if (sessionId === undefined) {
      const viewModel = buildSessionUsageErrorViewModel({
        message: "Usage: estacoda sessions show <session-id>",
      });
      return { ok: false, output: renderer(viewModel) };
    }
    const { SQLiteSessionDB } = await import("../session/sqlite-session-db.js");
    const db = new SQLiteSessionDB({ path: dbPath });
    const { FileSurfacePointerStore } = await import("../channels/surface-pointer-store.js");
    const pointerStore = new FileSurfacePointerStore({ path: join(homeDir, ".estacoda", "surface-pointers.json") });
    try {
      const session = await db.getSession(sessionId);
      if (session === undefined) {
        const viewModel = buildSessionNotFoundViewModel({ sessionId });
        return { ok: false, output: renderer(viewModel) };
      }
      const messages = await db.listMessages(sessionId);
      const sessionPointers = (await pointerStore.listPointers()).filter((p) => p.record.sessionId === sessionId);
      const viewModel = buildSessionShowViewModel({
        session,
        messageCount: messages.length,
        pointers: sessionPointers.map((p) => ({
          surfaceType: p.surfaceType,
          surfaceId: p.surfaceId,
          attachedAt: p.record.attachedAt,
          homeDelivery: p.record.homeDelivery,
        })),
      });
      return { ok: true, output: renderer(viewModel) };
    } finally {
      await db.close();
    }
  }

  if (subcommand === "current") {
    const runtime = input.runtime;
    if (runtime === undefined) {
      const viewModel = buildNoActiveSessionViewModel({
        message: "No active session in this shell.",
      });
      return { ok: false, output: renderer(viewModel) };
    }
    const { FileSurfacePointerStore } = await import("../channels/surface-pointer-store.js");
    const pointerStore = new FileSurfacePointerStore({ path: join(homeDir, ".estacoda", "surface-pointers.json") });
    const pointers = (await pointerStore.listPointers()).filter((p) => p.record.sessionId === runtime.sessionId);
    const viewModel = buildSessionCurrentViewModel({
      sessionId: runtime.sessionId,
      pointers: pointers.map((p) => ({
        surfaceType: p.surfaceType,
        surfaceId: p.surfaceId,
        attachedAt: p.record.attachedAt,
      })),
    });
    return { ok: true, output: renderer(viewModel) };
  }

  if (subcommand === "attach") {
    const [surface, surfaceId, sessionId] = rest;
    if (surface === undefined || surfaceId === undefined || sessionId === undefined) {
      const viewModel = buildSessionUsageErrorViewModel({
        message: "Usage: estacoda sessions attach <surface> <surface-id> <session-id>",
      });
      return { ok: false, output: renderer(viewModel) };
    }
    if (!VALID_SURFACES.includes(surface as typeof VALID_SURFACES[number])) {
      const viewModel = buildInvalidSurfaceViewModel({
        surface,
        validSurfaces: [...VALID_SURFACES],
      });
      return { ok: false, output: renderer(viewModel) };
    }
    const { FileSurfacePointerStore } = await import("../channels/surface-pointer-store.js");
    const pointerStore = new FileSurfacePointerStore({ path: join(homeDir, ".estacoda", "surface-pointers.json") });
    await pointerStore.setPointer(surface as typeof VALID_SURFACES[number], surfaceId, {
      sessionId,
      attachedAt: new Date().toISOString(),
    });
    const viewModel = buildSessionAttachViewModel({ surface, surfaceId, sessionId });
    return { ok: true, output: renderer(viewModel) };
  }

  if (subcommand === "detach") {
    const [surface, surfaceId] = rest;
    if (surface === undefined || surfaceId === undefined) {
      const viewModel = buildSessionUsageErrorViewModel({
        message: "Usage: estacoda sessions detach <surface> <surface-id>",
      });
      return { ok: false, output: renderer(viewModel) };
    }
    if (!VALID_SURFACES.includes(surface as typeof VALID_SURFACES[number])) {
      const viewModel = buildInvalidSurfaceViewModel({
        surface,
        validSurfaces: [...VALID_SURFACES],
      });
      return { ok: false, output: renderer(viewModel) };
    }
    const { FileSurfacePointerStore } = await import("../channels/surface-pointer-store.js");
    const pointerStore = new FileSurfacePointerStore({ path: join(homeDir, ".estacoda", "surface-pointers.json") });
    await pointerStore.removePointer(surface as typeof VALID_SURFACES[number], surfaceId);
    const viewModel = buildSessionDetachViewModel({ surface, surfaceId });
    return { ok: true, output: renderer(viewModel) };
  }

  return { ok: true, output: renderer(buildSessionsHelpViewModel()) };
}
