import {
  focusFirstOption,
  focusLastOption,
  focusNextOption,
  focusNextPage,
  focusOption,
  focusPreviousOption,
  focusPreviousPage,
  getFocusedOption,
  isFocusedInputRow,
  selectFocusedOption,
  type SelectNavigationState,
  updateInputValue,
} from "./selectModel.js";

export type SelectKeyName =
  | "arrowDown"
  | "arrowUp"
  | "pageDown"
  | "pageUp"
  | "home"
  | "end"
  | "enter"
  | "escape"
  | "tab"
  | "backtab";

export type SelectKeyEvent =
  | { readonly key: SelectKeyName }
  | { readonly key: "digit"; readonly digit: number };

export type SelectModelEvent<TValue = string> =
  | SelectKeyEvent
  | { readonly type: "input-change"; readonly value: TValue; readonly inputValue: string };

export type SelectIntent<TValue = string> =
  | { readonly type: "focus-changed"; readonly value: TValue; readonly inputFocused: boolean }
  | { readonly type: "selected"; readonly value: TValue; readonly inputValue?: string }
  | { readonly type: "cancel" }
  | { readonly type: "input-focused"; readonly value: TValue }
  | { readonly type: "input-changed"; readonly value: TValue; readonly inputValue: string };

export type SelectModelResult<TValue = string, TMetadata = unknown> = {
  readonly state: SelectNavigationState<TValue, TMetadata>;
  readonly intent?: SelectIntent<TValue>;
};

export function applySelectEvent<TValue = string, TMetadata = unknown>(
  state: SelectNavigationState<TValue, TMetadata>,
  event: SelectModelEvent<TValue>
): SelectModelResult<TValue, TMetadata> {
  if ("type" in event) {
    const nextState = updateInputValue(state, event.value, event.inputValue);
    if (nextState === state) return { state };
    return {
      state: nextState,
      intent: {
        type: "input-changed",
        value: event.value,
        inputValue: event.inputValue,
      },
    };
  }

  return applySelectKey(state, event);
}

export function applySelectKey<TValue = string, TMetadata = unknown>(
  state: SelectNavigationState<TValue, TMetadata>,
  event: SelectKeyEvent
): SelectModelResult<TValue, TMetadata> {
  switch (event.key) {
    case "arrowDown":
      return focusResult(state, focusNextOption(state));
    case "arrowUp":
      return focusResult(state, focusPreviousOption(state));
    case "pageDown":
      return focusResult(state, focusNextPage(state));
    case "pageUp":
      return focusResult(state, focusPreviousPage(state));
    case "home":
      return focusResult(state, focusFirstOption(state));
    case "end":
      return focusResult(state, focusLastOption(state));
    case "tab":
      return focusResult(state, focusNextOption(state));
    case "backtab":
      return focusResult(state, focusPreviousOption(state));
    case "escape":
      return {
        state,
        intent: { type: "cancel" },
      };
    case "enter":
      return selectResult(state);
    case "digit":
      return selectDigitShortcut(state, event.digit);
  }
}

function focusResult<TValue, TMetadata>(
  previousState: SelectNavigationState<TValue, TMetadata>,
  state: SelectNavigationState<TValue, TMetadata>
): SelectModelResult<TValue, TMetadata> {
  if (previousState.focusedValue === state.focusedValue || state.focusedValue === undefined) {
    return { state };
  }
  const inputFocused = isFocusedInputRow(state);
  return {
    state,
    intent: inputFocused
      ? { type: "input-focused", value: state.focusedValue }
      : { type: "focus-changed", value: state.focusedValue, inputFocused },
  };
}

function selectResult<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectModelResult<TValue, TMetadata> {
  const focused = getFocusedOption(state);
  if (focused === undefined || focused.disabled === true) return { state };
  const nextState = selectFocusedOption(state);
  const inputValue = focused.kind === "input" ? state.inputValues.get(focused.value) ?? "" : undefined;
  return {
    state: nextState,
    intent: {
      type: "selected",
      value: focused.value,
      ...(inputValue === undefined ? {} : { inputValue }),
    },
  };
}

function selectDigitShortcut<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>,
  digit: number
): SelectModelResult<TValue, TMetadata> {
  if (isFocusedInputRow(state)) return { state };
  if (!Number.isInteger(digit) || digit < 1) return { state };
  const option = state.optionMap.items[digit - 1];
  if (option === undefined || option.disabled === true) return { state };
  const focusedState = focusOption(state, option.value);
  return selectResult(focusedState);
}
