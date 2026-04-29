export type ArtifactKind =
  | "video"
  | "image"
  | "audio"
  | "document"
  | "data"
  | "other";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "video",
  "image",
  "audio",
  "document",
  "data",
  "other"
];

export type ArtifactRecord = {
  id: string;
  /** Prompt-safe reference or display path. Use localPath for filesystem access. */
  path: string;
  localPath?: string;
  kind: ArtifactKind;
  bytes: number;
  createdAt: string;
  summary?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && ARTIFACT_KINDS.includes(value as ArtifactKind);
}
