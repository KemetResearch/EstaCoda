import type { ArtifactRecord } from "../contracts/artifact.js";
import { formatBytes } from "./formatting.js";

export function artifactReference(artifact: ArtifactRecord): string {
  return `${artifact.path}:${artifact.id}`;
}

export function truncateSummary(summary: string): string {
  return summary.length > 120 ? `${summary.slice(0, 120)}...` : summary;
}

export function renderArtifactProgress(artifacts: ArtifactRecord[]): string[] {
  return artifacts.map((artifact) => `artifact: ${artifactReference(artifact)} (${artifact.kind}, ${formatBytes(artifact.bytes)})`);
}

export function appendArtifactSummary(text: string, artifacts: ArtifactRecord[]): string {
  if (artifacts.length === 0) {
    return text;
  }

  const lower = text.toLowerCase();
  const missingArtifacts = artifacts.filter((artifact) => !lower.includes(artifactReference(artifact).toLowerCase()));
  if (missingArtifacts.length === 0) {
    return text;
  }

  return [
    text.trimEnd(),
    "",
    "Artifacts:",
    ...missingArtifacts.map((artifact) =>
      `- ${artifactReference(artifact)} (${artifact.kind}, ${formatBytes(artifact.bytes)})${artifact.summary === undefined ? "" : ` - ${truncateSummary(artifact.summary)}`}`
    )
  ].join("\n");
}
