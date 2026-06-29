import { describe, expect, it } from "vitest";
import { stringWidth } from "../screen/stringWidth.js";
import {
  getTranscriptSurfaceDesiredHeight,
  renderTranscriptSurface,
  type TranscriptBlock,
} from "./index.js";

describe("Papyrus operator console transcript surface", () => {
  it("renders transcript blocks with role prefixes", () => {
    const rows = renderTranscriptSurface([
      { id: "user-1", role: "user", text: "Please inspect the stream path." },
      { id: "assistant-1", role: "assistant", text: "I found the controller and renderer." },
    ], { width: 72 });

    expect(rows).toEqual([
      "User │ Please inspect the stream path.",
      "Assistant │ I found the controller and renderer.",
    ]);
    expect(rows.every((line) => stringWidth(line) <= 72)).toBe(true);
  });

  it("wraps and truncates to the visible height cap", () => {
    const transcript: TranscriptBlock[] = [
      {
        id: "assistant-1",
        role: "assistant",
        text: "This is a deliberately long assistant response that should wrap across several terminal rows without exceeding the requested width.",
      },
      { id: "tool-1", role: "tool", text: "read_file completed" },
      { id: "assistant-2", role: "assistant", text: "Final visible row." },
    ];

    const rows = renderTranscriptSurface(transcript, { width: 44, height: 3 });

    expect(rows).toEqual([
      "Tool │ read_file completed",
      "Assistant │ Final visible row.",
    ]);
    expect(getTranscriptSurfaceDesiredHeight(transcript, 44)).toBeGreaterThanOrEqual(rows.length);
    expect(rows.every((line) => stringWidth(line) <= 44)).toBe(true);
  });

  it("returns no rows for empty transcript state", () => {
    expect(renderTranscriptSurface([], { width: 80 })).toEqual([]);
    expect(getTranscriptSurfaceDesiredHeight([], 80)).toBe(0);
  });
});
