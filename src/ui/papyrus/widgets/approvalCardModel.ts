export type ApprovalCardSeverity = "info" | "warning" | "danger";

export type ApprovalCardAction<TValue = string> = {
  readonly value: TValue;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
};

export type ApprovalCardDetailRow =
  | { readonly kind: "body"; readonly text: string }
  | { readonly kind: "detail"; readonly label: string; readonly value: string }
  | { readonly kind: "hint"; readonly text: string };

export type ApprovalCardKeyboardHint = {
  readonly key: string;
  readonly label: string;
};

export type ApprovalCardState<TValue = string> = {
  readonly title: string;
  readonly body?: string;
  readonly severity?: ApprovalCardSeverity;
  readonly riskLabel?: string;
  readonly details: readonly ApprovalCardDetailRow[];
  readonly actions: readonly ApprovalCardAction<TValue>[];
  readonly focusedAction?: TValue;
  readonly cancelable: boolean;
  readonly keyboardHints: readonly ApprovalCardKeyboardHint[];
};

export type ApprovalCardIntent<TValue = string> =
  | { readonly type: "action"; readonly value: TValue }
  | { readonly type: "cancel" };

export type ApprovalCardResult<TValue = string> = {
  readonly state: ApprovalCardState<TValue>;
  readonly intent?: ApprovalCardIntent<TValue>;
};

export type ApprovalCardKeyEvent = {
  readonly key: "arrowLeft" | "arrowRight" | "arrowUp" | "arrowDown" | "home" | "end" | "enter" | "escape" | "tab" | "backtab";
};

export type ApprovalCardRenderRow<TValue = string> =
  | {
      readonly kind: "title";
      readonly text: string;
      readonly severity?: ApprovalCardSeverity;
      readonly riskLabel?: string;
    }
  | { readonly kind: "body"; readonly text: string }
  | { readonly kind: "detail"; readonly label: string; readonly value: string }
  | { readonly kind: "hint"; readonly text: string }
  | {
      readonly kind: "action";
      readonly value: TValue;
      readonly label: string;
      readonly description?: string;
      readonly focused: boolean;
      readonly disabled: boolean;
    }
  | {
      readonly kind: "keyboardHint";
      readonly key: string;
      readonly label: string;
    };

export function createApprovalCardState<TValue = string>(input: {
  readonly title: string;
  readonly body?: string;
  readonly severity?: ApprovalCardSeverity;
  readonly riskLabel?: string;
  readonly details?: readonly ApprovalCardDetailRow[];
  readonly actions: readonly ApprovalCardAction<TValue>[];
  readonly focusedAction?: TValue;
  readonly cancelable?: boolean;
  readonly keyboardHints?: readonly ApprovalCardKeyboardHint[];
}): ApprovalCardState<TValue> {
  const focusedAction = enabledApprovalAction(input.actions, input.focusedAction)?.value
    ?? firstEnabledApprovalAction(input.actions)?.value;
  return {
    title: input.title,
    body: input.body,
    severity: input.severity,
    riskLabel: input.riskLabel,
    details: input.details ?? [],
    actions: input.actions,
    focusedAction,
    cancelable: input.cancelable ?? true,
    keyboardHints: input.keyboardHints ?? [],
  };
}

export function applyApprovalCardKey<TValue = string>(
  state: ApprovalCardState<TValue>,
  event: ApprovalCardKeyEvent
): ApprovalCardResult<TValue> {
  switch (event.key) {
    case "arrowRight":
    case "arrowDown":
    case "tab":
      return { state: focusApprovalCardAction(state, "next") };
    case "arrowLeft":
    case "arrowUp":
    case "backtab":
      return { state: focusApprovalCardAction(state, "previous") };
    case "home":
      return { state: setFocusedApprovalCardAction(state, firstEnabledApprovalAction(state.actions)?.value) };
    case "end":
      return { state: setFocusedApprovalCardAction(state, lastEnabledApprovalAction(state.actions)?.value) };
    case "enter":
      return selectFocusedApprovalCardAction(state);
    case "escape":
      return state.cancelable ? { state, intent: { type: "cancel" } } : { state };
  }
}

export function setFocusedApprovalCardAction<TValue>(
  state: ApprovalCardState<TValue>,
  value: TValue | undefined
): ApprovalCardState<TValue> {
  const action = enabledApprovalAction(state.actions, value);
  if (action === undefined) return state;
  return {
    ...state,
    focusedAction: action.value,
  };
}

export function selectFocusedApprovalCardAction<TValue>(
  state: ApprovalCardState<TValue>
): ApprovalCardResult<TValue> {
  const action = enabledApprovalAction(state.actions, state.focusedAction);
  if (action === undefined) return { state };
  return {
    state,
    intent: {
      type: "action",
      value: action.value,
    },
  };
}

export function buildApprovalCardRenderRows<TValue = string>(
  state: ApprovalCardState<TValue>
): readonly ApprovalCardRenderRow<TValue>[] {
  return [
    {
      kind: "title",
      text: state.title,
      severity: state.severity,
      riskLabel: state.riskLabel,
    },
    ...(state.body === undefined ? [] : [{ kind: "body" as const, text: state.body }]),
    ...state.details,
    ...state.actions.map((action) => ({
      kind: "action" as const,
      value: action.value,
      label: action.label,
      description: action.description,
      focused: action.value === state.focusedAction,
      disabled: action.disabled === true,
    })),
    ...state.keyboardHints.map((hint) => ({
      kind: "keyboardHint" as const,
      key: hint.key,
      label: hint.label,
    })),
  ];
}

function focusApprovalCardAction<TValue>(
  state: ApprovalCardState<TValue>,
  direction: "next" | "previous"
): ApprovalCardState<TValue> {
  const enabledActions = state.actions.filter((action) => action.disabled !== true);
  if (enabledActions.length === 0) return state;
  const currentIndex = enabledActions.findIndex((action) => action.value === state.focusedAction);
  const fallbackIndex = direction === "next" ? 0 : enabledActions.length - 1;
  const nextIndex = currentIndex < 0
    ? fallbackIndex
    : direction === "next"
      ? (currentIndex + 1) % enabledActions.length
      : (currentIndex - 1 + enabledActions.length) % enabledActions.length;
  return {
    ...state,
    focusedAction: enabledActions[nextIndex]?.value,
  };
}

function enabledApprovalAction<TValue>(
  actions: readonly ApprovalCardAction<TValue>[],
  value: TValue | undefined
): ApprovalCardAction<TValue> | undefined {
  if (value === undefined) return undefined;
  return actions.find((action) => action.value === value && action.disabled !== true);
}

function firstEnabledApprovalAction<TValue>(
  actions: readonly ApprovalCardAction<TValue>[]
): ApprovalCardAction<TValue> | undefined {
  return actions.find((action) => action.disabled !== true);
}

function lastEnabledApprovalAction<TValue>(
  actions: readonly ApprovalCardAction<TValue>[]
): ApprovalCardAction<TValue> | undefined {
  return [...actions].reverse().find((action) => action.disabled !== true);
}
