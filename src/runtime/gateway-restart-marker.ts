import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ProfileStatePaths } from "../config/profile-home.js";

export type GatewayRestartPlannedReason = "gateway-restart" | "update";

export type GatewayRestartPlannedMarker = {
  plannedAt: string;
  reason: GatewayRestartPlannedReason;
};

const MARKER_FILE_NAME = "restart-planned.json";

export function gatewayRestartPlannedMarkerPath(profilePaths: ProfileStatePaths): string {
  return join(profilePaths.gatewayStatePath, MARKER_FILE_NAME);
}

export async function writeGatewayRestartPlannedMarker(
  profilePaths: ProfileStatePaths,
  marker: GatewayRestartPlannedMarker
): Promise<void> {
  const parsed = parseGatewayRestartPlannedMarker(marker);
  if (parsed === undefined) {
    throw new Error("Invalid gateway restart planned marker");
  }

  const path = gatewayRestartPlannedMarkerPath(profilePaths);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${MARKER_FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export async function readGatewayRestartPlannedMarker(
  profilePaths: ProfileStatePaths
): Promise<GatewayRestartPlannedMarker | undefined> {
  try {
    const parsed = JSON.parse(await readFile(gatewayRestartPlannedMarkerPath(profilePaths), "utf8")) as unknown;
    return parseGatewayRestartPlannedMarker(parsed);
  } catch {
    return undefined;
  }
}

export async function clearGatewayRestartPlannedMarker(profilePaths: ProfileStatePaths): Promise<void> {
  await rm(gatewayRestartPlannedMarkerPath(profilePaths), { force: true }).catch(() => undefined);
}

export function isGatewayRestartPlannedMarkerProfileLocal(profilePaths: ProfileStatePaths): boolean {
  const markerPath = resolve(gatewayRestartPlannedMarkerPath(profilePaths));
  const gatewayPath = resolve(profilePaths.gatewayStatePath);
  return markerPath === join(gatewayPath, MARKER_FILE_NAME);
}

function parseGatewayRestartPlannedMarker(value: unknown): GatewayRestartPlannedMarker | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.plannedAt !== "string" || Number.isNaN(Date.parse(record.plannedAt))) {
    return undefined;
  }

  if (record.reason !== "gateway-restart" && record.reason !== "update") {
    return undefined;
  }

  return {
    plannedAt: record.plannedAt,
    reason: record.reason
  };
}
