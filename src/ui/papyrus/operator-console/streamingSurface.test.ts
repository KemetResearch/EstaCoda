import { describe, expect, it } from "vitest";
import {
  getStreamingSurfaceDesiredHeight,
  hasStreamingSurface,
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

    expect(hasStreamingSurface(state)).toBe(true);
    expect(renderStreamingSurface(state, { width: 80 }).join("\n")).toContain("Visible tail.");
  });
});
