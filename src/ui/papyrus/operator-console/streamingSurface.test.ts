import { describe, expect, it } from "vitest";
import {
  getStreamingSurfaceDesiredHeight,
  hasStreamingSurface,
  renderTranscriptSurface,
  renderStreamingSurface,
  type StreamingState,
} from "./index.js";

describe("Papyrus operator console streaming surface", () => {
  it("does not render whitespace-only streaming state", () => {
    const state: StreamingState = {
      segments: [{ id: "segment-1", role: "assistant", text: "   \n\t" }],
      tail: "   ",
      isStreaming: true,
    };

    expect(hasStreamingSurface(state)).toBe(false);
    expect(getStreamingSurfaceDesiredHeight(state, 80)).toBe(0);
    expect(renderStreamingSurface(state, { width: 80 })).toEqual([]);
  });

  it("renders non-empty visible streaming text", () => {
    const state: StreamingState = {
      segments: [{ id: "segment-1", role: "assistant", text: "Visible segment." }],
      tail: "Visible tail.",
      isStreaming: true,
    };
    const rendered = renderStreamingSurface(state, { width: 80 }).join("\n");

    expect(hasStreamingSurface(state)).toBe(true);
    expect(rendered).toContain("EstaCoda");
    expect(rendered).toContain("Visible segment.");
    expect(rendered).toContain("Visible tail.▍");
    expect(rendered).not.toContain("Assistant stream");
    expect(rendered).not.toContain("assistant:");
  });

  it("settles into the same assistant frame without the live cursor", () => {
    const state: StreamingState = {
      segments: [{ id: "segment-1", role: "assistant", text: "Visible segment." }],
      tail: "",
      isStreaming: true,
    };
    const liveRows = renderStreamingSurface(state, { width: 72 });
    const settledRows = renderTranscriptSurface([
      { id: "assistant-1", role: "assistant", text: "Visible segment." },
    ], { width: 72 });

    expect(liveRows[0]).toBe(settledRows[0]);
    expect(liveRows.at(-1)).toBe(settledRows.at(-1));
    expect(extractFrameContent(liveRows[1]?.replace("▍", "") ?? "")).toBe(
      extractFrameContent(settledRows[1] ?? "")
    );
  });
});

function extractFrameContent(line: string): string {
  return line.replace(/^│ /u, "").replace(/ │$/u, "").trim();
}
