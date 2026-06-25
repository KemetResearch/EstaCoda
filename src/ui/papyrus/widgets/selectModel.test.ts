import { describe, expect, it } from "vitest";
import {
  createOptionMap,
  createSelectNavigationState,
  DuplicatePapyrusOptionValueError,
  focusFirstOption,
  focusLastOption,
  focusNextOption,
  focusNextPage,
  focusOption,
  focusPreviousOption,
  focusPreviousPage,
  getVisibleOptions,
  reconcileSelectNavigationState,
  type PapyrusOption,
} from "./index.js";

const options: Array<PapyrusOption<string>> = [
  { value: "alpha", label: "Alpha" },
  { value: "bravo", label: "Bravo", disabled: true },
  { value: "charlie", label: "Charlie" },
  { value: "delta", label: "Delta" },
  { value: "echo", label: "Echo", disabled: true },
  { value: "foxtrot", label: "Foxtrot" },
];

describe("Papyrus option map", () => {
  it("builds an ordered map and preserves original indexes", () => {
    const map = createOptionMap(options);

    expect(map.items.map((item) => item.value)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
    ]);
    expect(map.get("charlie")).toMatchObject({ value: "charlie", index: 2 });
  });

  it("finds first and last enabled options", () => {
    const map = createOptionMap(options);

    expect(map.getFirstEnabled()?.value).toBe("alpha");
    expect(map.getLastEnabled()?.value).toBe("foxtrot");
  });

  it("moves next and previous while skipping disabled options", () => {
    const map = createOptionMap(options);

    expect(map.getNextEnabled("alpha")?.value).toBe("charlie");
    expect(map.getPreviousEnabled("charlie")?.value).toBe("alpha");
    expect(map.getNextEnabled("delta")?.value).toBe("foxtrot");
    expect(map.getPreviousEnabled("foxtrot")?.value).toBe("delta");
  });

  it("handles all-disabled options safely", () => {
    const map = createOptionMap([
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B", disabled: true },
    ]);

    expect(map.enabledSize).toBe(0);
    expect(map.getFirstEnabled()).toBeUndefined();
    expect(map.getLastEnabled()).toBeUndefined();
    expect(map.getNextEnabled("a")).toBeUndefined();
  });

  it("rejects duplicate values deterministically", () => {
    expect(() =>
      createOptionMap([
        { value: "same", label: "First" },
        { value: "same", label: "Second" },
      ])
    ).toThrow(DuplicatePapyrusOptionValueError);
  });
});

describe("Papyrus select navigation model", () => {
  it("sets initial focus to the requested enabled value", () => {
    const state = createSelectNavigationState(options, {
      focusedValue: "charlie",
      viewportSize: 3,
    });

    expect(state.focusedValue).toBe("charlie");
    expect(getVisibleOptions(state).map((item) => item.value)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("falls back to the first enabled option for disabled or missing initial focus", () => {
    expect(createSelectNavigationState(options, { focusedValue: "bravo" }).focusedValue).toBe("alpha");
    expect(createSelectNavigationState(options, { focusedValue: "missing" }).focusedValue).toBe("alpha");
  });

  it("moves focus next and previous across enabled options", () => {
    let state = createSelectNavigationState(options, { viewportSize: 3 });

    state = focusNextOption(state);
    expect(state.focusedValue).toBe("charlie");

    state = focusNextOption(state);
    expect(state.focusedValue).toBe("delta");

    state = focusPreviousOption(state);
    expect(state.focusedValue).toBe("charlie");
  });

  it("wraps next and previous when wrapping is enabled", () => {
    let state = createSelectNavigationState(options, {
      focusedValue: "foxtrot",
      viewportSize: 3,
      wrap: true,
    });

    state = focusNextOption(state);
    expect(state.focusedValue).toBe("alpha");
    expect(state.viewportStart).toBe(0);

    state = focusPreviousOption(state);
    expect(state.focusedValue).toBe("foxtrot");
    expect(state.viewportStart).toBe(3);
  });

  it("does not wrap when wrapping is disabled", () => {
    let state = createSelectNavigationState(options, {
      focusedValue: "foxtrot",
      viewportSize: 3,
      wrap: false,
    });

    state = focusNextOption(state);
    expect(state.focusedValue).toBe("foxtrot");

    state = focusFirstOption(state);
    state = focusPreviousOption(state);
    expect(state.focusedValue).toBe("alpha");
  });

  it("moves by pages over enabled options", () => {
    let state = createSelectNavigationState(options, {
      viewportSize: 2,
      focusedValue: "alpha",
    });

    state = focusNextPage(state);
    expect(state.focusedValue).toBe("delta");
    expect(getVisibleOptions(state).map((item) => item.value)).toEqual(["charlie", "delta"]);

    state = focusPreviousPage(state);
    expect(state.focusedValue).toBe("alpha");
    expect(state.viewportStart).toBe(0);
  });

  it("moves to first and last enabled options", () => {
    let state = createSelectNavigationState(options, {
      focusedValue: "charlie",
      viewportSize: 3,
    });

    state = focusLastOption(state);
    expect(state.focusedValue).toBe("foxtrot");

    state = focusFirstOption(state);
    expect(state.focusedValue).toBe("alpha");
  });

  it("does not focus disabled rows", () => {
    const state = createSelectNavigationState(options, { focusedValue: "charlie" });

    expect(focusOption(state, "bravo").focusedValue).toBe("charlie");
  });

  it("preserves viewport around focused items", () => {
    let state = createSelectNavigationState(options, {
      focusedValue: "alpha",
      viewportSize: 3,
    });

    state = focusOption(state, "foxtrot");
    expect(state.focusedValue).toBe("foxtrot");
    expect(getVisibleOptions(state).map((item) => item.value)).toEqual(["delta", "echo", "foxtrot"]);

    state = focusOption(state, "charlie");
    expect(state.viewportStart).toBe(2);
  });

  it("reconciles focus and viewport after option list changes", () => {
    const state = createSelectNavigationState(options, {
      focusedValue: "delta",
      selectedValue: "charlie",
      viewportSize: 3,
      viewportStart: 2,
    });

    const reconciled = reconcileSelectNavigationState(state, [
      { value: "alpha", label: "Alpha" },
      { value: "charlie", label: "Charlie" },
      { value: "golf", label: "Golf" },
      { value: "hotel", label: "Hotel" },
    ]);

    expect(reconciled.focusedValue).toBe("charlie");
    expect(reconciled.selectedValue).toBe("charlie");
    expect(getVisibleOptions(reconciled).map((item) => item.value)).toContain("charlie");
  });

  it("handles all-disabled navigation without changing focus", () => {
    const state = createSelectNavigationState([
      { value: "a", label: "A", disabled: true },
      { value: "b", label: "B", disabled: true },
    ]);

    expect(state.focusedValue).toBeUndefined();
    expect(focusNextOption(state).focusedValue).toBeUndefined();
    expect(focusPreviousPage(state).focusedValue).toBeUndefined();
  });
});
