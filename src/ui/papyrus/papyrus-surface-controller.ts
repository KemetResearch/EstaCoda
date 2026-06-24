import type { UiRendererMode } from "../renderer-mode.js";
import type { CompositorSize } from "./screen/compositor.js";
import { createCompositor, type Compositor } from "./screen/compositor.js";
import type { Diff, Frame } from "./screen/frame.js";
import { diffFrames, renderDiff } from "./screen/logUpdate.js";
import type { WriteOptions } from "./screen/output.js";

export type PapyrusSurface = {
  x: number;
  y: number;
  text: string;
  options?: WriteOptions;
};

export type PapyrusSurfaceFrame = {
  surfaces: readonly PapyrusSurface[];
};

export type PapyrusSurfaceRenderResult = {
  frame: Frame;
  diff: Diff;
  output: string;
};

export class PapyrusSurfaceController {
  private compositor: Compositor;
  private previousFrame: Frame;

  constructor(size: Partial<CompositorSize>) {
    this.compositor = createCompositor(size);
    this.previousFrame = this.compositor.snapshot();
  }

  initialize(width: number, height: number): PapyrusSurfaceRenderResult {
    this.compositor = createCompositor({ width, height });
    this.previousFrame = this.compositor.snapshot();
    return this.emptyResult();
  }

  resize(width: number, height: number): PapyrusSurfaceRenderResult {
    const previous = this.previousFrame;
    const next = this.compositor.resize({ width, height });
    return this.commit(previous, next);
  }

  render(frame: PapyrusSurfaceFrame): PapyrusSurfaceRenderResult {
    const previous = this.previousFrame;
    this.compositor.beginFrame();

    for (const surface of frame.surfaces) {
      this.compositor.write(surface.x, surface.y, surface.text, surface.options);
    }

    return this.commit(previous, this.compositor.snapshot());
  }

  reset(): PapyrusSurfaceRenderResult {
    const previous = this.previousFrame;
    this.compositor.beginFrame();
    return this.commit(previous, this.compositor.snapshot());
  }

  getSize(): CompositorSize {
    return this.compositor.getSize();
  }

  snapshot(): Frame {
    return this.previousFrame;
  }

  private commit(previous: Frame, next: Frame): PapyrusSurfaceRenderResult {
    const diff = diffFrames(previous, next);
    this.previousFrame = next;
    return {
      frame: next,
      diff,
      output: renderDiff(diff),
    };
  }

  private emptyResult(): PapyrusSurfaceRenderResult {
    return {
      frame: this.previousFrame,
      diff: [],
      output: "",
    };
  }
}

export function createPapyrusSurfaceController(size: Partial<CompositorSize>): PapyrusSurfaceController {
  return new PapyrusSurfaceController(size);
}

export function createPapyrusSurfaceControllerForMode(
  rendererMode: UiRendererMode,
  size: Partial<CompositorSize>,
): PapyrusSurfaceController | undefined {
  if (rendererMode !== "papyrus") return undefined;
  return createPapyrusSurfaceController(size);
}
