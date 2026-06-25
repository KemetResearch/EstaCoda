import {
  PapyrusOptionMap,
  type PapyrusOption,
  type PapyrusOptionItem,
} from "./optionMap.js";

export type SelectNavigationState<TValue = string, TMetadata = unknown> = {
  readonly optionMap: PapyrusOptionMap<TValue, TMetadata>;
  readonly focusedValue?: TValue;
  readonly selectedValue?: TValue;
  readonly inputValues: ReadonlyMap<TValue, string>;
  readonly viewportStart: number;
  readonly viewportSize: number;
  readonly wrap: boolean;
};

export type CreateSelectNavigationStateOptions<TValue = string> = {
  readonly focusedValue?: TValue;
  readonly selectedValue?: TValue;
  readonly inputValues?: ReadonlyMap<TValue, string> | ReadonlyArray<readonly [TValue, string]>;
  readonly viewportStart?: number;
  readonly viewportSize?: number;
  readonly wrap?: boolean;
};

export function createSelectNavigationState<TValue = string, TMetadata = unknown>(
  options: readonly PapyrusOption<TValue, TMetadata>[],
  stateOptions: CreateSelectNavigationStateOptions<TValue> = {}
): SelectNavigationState<TValue, TMetadata> {
  const optionMap = new PapyrusOptionMap(options);
  const viewportSize = normalizeViewportSize(stateOptions.viewportSize);
  const requestedFocus = enabledValueOrUndefined(optionMap, stateOptions.focusedValue);
  const selectedValue = valueExists(optionMap, stateOptions.selectedValue)
    ? stateOptions.selectedValue
    : undefined;
  const focusedValue = requestedFocus ?? enabledValueOrUndefined(optionMap, selectedValue) ?? optionMap.firstEnabled?.value;
  const viewportStart = normalizeViewportStart({
    optionMap,
    viewportStart: stateOptions.viewportStart ?? 0,
    viewportSize,
    focusedValue,
  });

  return {
    optionMap,
    focusedValue,
    selectedValue,
    inputValues: normalizeInputValues(stateOptions.inputValues),
    viewportStart,
    viewportSize,
    wrap: stateOptions.wrap ?? true,
  };
}

export function getFocusedOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): PapyrusOptionItem<TValue, TMetadata> | undefined {
  return state.focusedValue === undefined ? undefined : state.optionMap.get(state.focusedValue);
}

export function getVisibleOptions<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): readonly PapyrusOptionItem<TValue, TMetadata>[] {
  return state.optionMap.items.slice(state.viewportStart, state.viewportStart + state.viewportSize);
}

export function isFocusedInputRow<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): boolean {
  const focused = getFocusedOption(state);
  return focused?.kind === "input";
}

export function focusNextOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  if (state.focusedValue === undefined) return focusOptionItem(state, state.optionMap.firstEnabled);
  return focusOptionItem(
    state,
    state.optionMap.getNextEnabled(state.focusedValue, { wrap: state.wrap })
  );
}

export function focusPreviousOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  if (state.focusedValue === undefined) return focusOptionItem(state, state.optionMap.lastEnabled);
  return focusOptionItem(
    state,
    state.optionMap.getPreviousEnabled(state.focusedValue, { wrap: state.wrap })
  );
}

export function focusFirstOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  return focusOptionItem(state, state.optionMap.firstEnabled);
}

export function focusLastOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  return focusOptionItem(state, state.optionMap.lastEnabled);
}

export function focusNextPage<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  return focusByEnabledOffset(state, state.viewportSize);
}

export function focusPreviousPage<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  return focusByEnabledOffset(state, -state.viewportSize);
}

export function focusOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>,
  value: TValue | undefined
): SelectNavigationState<TValue, TMetadata> {
  if (value === undefined) return state;
  const item = state.optionMap.get(value);
  if (item?.disabled === true) return state;
  return focusOptionItem(state, item);
}

export function selectFocusedOption<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>
): SelectNavigationState<TValue, TMetadata> {
  const focused = getFocusedOption(state);
  if (focused === undefined || focused.disabled === true) return state;
  return {
    ...state,
    selectedValue: focused.value,
  };
}

export function updateInputValue<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>,
  value: TValue,
  inputValue: string
): SelectNavigationState<TValue, TMetadata> {
  const item = state.optionMap.get(value);
  if (item?.kind !== "input" || item.disabled === true) return state;
  const inputValues = new Map(state.inputValues);
  inputValues.set(value, inputValue);
  return {
    ...state,
    inputValues,
  };
}

export function reconcileSelectNavigationState<TValue = string, TMetadata = unknown>(
  state: SelectNavigationState<TValue, TMetadata>,
  options: readonly PapyrusOption<TValue, TMetadata>[]
): SelectNavigationState<TValue, TMetadata> {
  const nextMap = new PapyrusOptionMap(options);
  const focusedValue = enabledValueOrUndefined(nextMap, state.focusedValue)
    ?? enabledValueOrUndefined(nextMap, state.selectedValue)
    ?? nextMap.firstEnabled?.value;
  const selectedValue = valueExists(nextMap, state.selectedValue) ? state.selectedValue : undefined;
  const viewportStart = normalizeViewportStart({
    optionMap: nextMap,
    viewportStart: state.viewportStart,
    viewportSize: state.viewportSize,
    focusedValue,
  });

  return {
    optionMap: nextMap,
    focusedValue,
    selectedValue,
    inputValues: reconcileInputValues(nextMap, state.inputValues),
    viewportStart,
    viewportSize: state.viewportSize,
    wrap: state.wrap,
  };
}

function focusByEnabledOffset<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>,
  offset: number
): SelectNavigationState<TValue, TMetadata> {
  if (state.optionMap.enabledSize === 0) return state;
  const rank = state.focusedValue === undefined
    ? 0
    : state.optionMap.getEnabledRank(state.focusedValue) ?? 0;
  const nextRank = Math.min(
    Math.max(0, rank + offset),
    state.optionMap.enabledSize - 1
  );
  return focusOptionItem(state, state.optionMap.enabledItems[nextRank]);
}

function focusOptionItem<TValue, TMetadata>(
  state: SelectNavigationState<TValue, TMetadata>,
  item: PapyrusOptionItem<TValue, TMetadata> | undefined
): SelectNavigationState<TValue, TMetadata> {
  if (item === undefined || item.disabled === true) return state;
  return {
    ...state,
    focusedValue: item.value,
    viewportStart: ensureIndexVisible({
      itemIndex: item.index,
      optionCount: state.optionMap.size,
      viewportStart: state.viewportStart,
      viewportSize: state.viewportSize,
    }),
  };
}

function enabledValueOrUndefined<TValue, TMetadata>(
  optionMap: PapyrusOptionMap<TValue, TMetadata>,
  value: TValue | undefined
): TValue | undefined {
  if (value === undefined) return undefined;
  const item = optionMap.get(value);
  return item !== undefined && item.disabled !== true ? item.value : undefined;
}

function valueExists<TValue, TMetadata>(
  optionMap: PapyrusOptionMap<TValue, TMetadata>,
  value: TValue | undefined
): boolean {
  return value !== undefined && optionMap.get(value) !== undefined;
}

function normalizeViewportSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.floor(value));
}

function normalizeInputValues<TValue>(
  values: ReadonlyMap<TValue, string> | ReadonlyArray<readonly [TValue, string]> | undefined
): ReadonlyMap<TValue, string> {
  return values === undefined ? new Map() : new Map(values);
}

function reconcileInputValues<TValue, TMetadata>(
  optionMap: PapyrusOptionMap<TValue, TMetadata>,
  values: ReadonlyMap<TValue, string>
): ReadonlyMap<TValue, string> {
  const nextValues = new Map<TValue, string>();
  for (const [value, inputValue] of values) {
    if (optionMap.get(value)?.kind === "input") {
      nextValues.set(value, inputValue);
    }
  }
  return nextValues;
}

function normalizeViewportStart<TValue, TMetadata>(input: {
  readonly optionMap: PapyrusOptionMap<TValue, TMetadata>;
  readonly viewportStart: number;
  readonly viewportSize: number;
  readonly focusedValue?: TValue;
}): number {
  const maxStart = Math.max(0, input.optionMap.size - input.viewportSize);
  const viewportStart = Math.min(Math.max(0, Math.floor(input.viewportStart)), maxStart);
  const focusedItem = input.focusedValue === undefined ? undefined : input.optionMap.get(input.focusedValue);
  if (focusedItem === undefined) return viewportStart;
  return ensureIndexVisible({
    itemIndex: focusedItem.index,
    optionCount: input.optionMap.size,
    viewportStart,
    viewportSize: input.viewportSize,
  });
}

function ensureIndexVisible(input: {
  readonly itemIndex: number;
  readonly optionCount: number;
  readonly viewportStart: number;
  readonly viewportSize: number;
}): number {
  if (input.optionCount <= 0) return 0;
  const maxStart = Math.max(0, input.optionCount - input.viewportSize);
  const viewportStart = Math.min(Math.max(0, input.viewportStart), maxStart);
  if (input.itemIndex < viewportStart) return input.itemIndex;
  if (input.itemIndex >= viewportStart + input.viewportSize) {
    return Math.min(maxStart, input.itemIndex - input.viewportSize + 1);
  }
  return viewportStart;
}
