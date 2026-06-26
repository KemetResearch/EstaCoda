import {
  applySuggestionReplacement,
  normalizeSuggestionProviderError,
  normalizeSuggestionProviderResult,
  type SuggestionItem,
  type SuggestionProvider,
  type SuggestionProviderError,
  type SuggestionProviderResult,
  type SuggestionTokenContext,
} from "./suggestionTypes.js";

export type TypeaheadStatus =
  | "closed"
  | "loading"
  | "open"
  | "empty"
  | "error"
  | "canceled"
  | "dismissed";

export type TypeaheadState<TMetadata = unknown> = {
  readonly status: TypeaheadStatus;
  readonly context?: SuggestionTokenContext;
  readonly providerId?: string;
  readonly items: readonly SuggestionItem<TMetadata>[];
  readonly focusedIndex?: number;
  readonly error?: SuggestionProviderError;
  readonly generation: number;
  readonly requestId?: string;
  readonly stale?: boolean;
};

export type TypeaheadRequest<TMetadata = unknown> = {
  readonly state: TypeaheadState<TMetadata>;
  readonly generation: number;
  readonly requestId: string;
  readonly providerId?: string;
  readonly result: Promise<SuggestionProviderResult<TMetadata>>;
};

export type TypeaheadIntent<TMetadata = unknown> =
  | {
      readonly type: "replace";
      readonly item: SuggestionItem<TMetadata>;
      readonly replacementText: string;
      readonly replacementRange: SuggestionItem<TMetadata>["replacementRange"];
      readonly nextInput: string;
    }
  | { readonly type: "dismiss" };

export type TypeaheadUpdate<TMetadata = unknown> = {
  readonly state: TypeaheadState<TMetadata>;
  readonly intent?: TypeaheadIntent<TMetadata>;
};

export function createTypeaheadControllerState<TMetadata = unknown>(
  options: {
    readonly context?: SuggestionTokenContext;
    readonly generation?: number;
  } = {}
): TypeaheadState<TMetadata> {
  return {
    status: "closed",
    context: options.context,
    items: [],
    generation: options.generation ?? 0,
  };
}

export function openTypeahead<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>,
  context: SuggestionTokenContext,
  providers: readonly SuggestionProvider<TMetadata>[]
): TypeaheadState<TMetadata> {
  const provider = providers[0];
  if (provider === undefined) {
    return {
      ...state,
      status: "closed",
      context,
      providerId: undefined,
      items: [],
      focusedIndex: undefined,
      error: undefined,
    };
  }

  return {
    ...state,
    status: "loading",
    context,
    providerId: provider.id,
    items: [],
    focusedIndex: undefined,
    error: undefined,
    stale: undefined,
  };
}

export function requestTypeaheadSuggestions<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>,
  context: SuggestionTokenContext,
  providers: readonly SuggestionProvider<TMetadata>[],
  options: {
    readonly signal?: AbortSignal;
    readonly requestId?: string;
  } = {}
): TypeaheadRequest<TMetadata> {
  const provider = providers[0];
  const generation = state.generation + 1;
  const requestId = options.requestId ?? `typeahead-${generation}`;
  const nextState: TypeaheadState<TMetadata> = provider === undefined
    ? {
        ...state,
        status: "closed",
        context,
        providerId: undefined,
        items: [],
        focusedIndex: undefined,
        error: undefined,
        generation,
        requestId,
        stale: undefined,
      }
    : {
        ...state,
        status: "loading",
        context,
        providerId: provider.id,
        items: [],
        focusedIndex: undefined,
        error: undefined,
        generation,
        requestId,
        stale: undefined,
      };

  return {
    state: nextState,
    generation,
    requestId,
    providerId: provider?.id,
    result: resolveProviderResult(provider, context, generation, requestId, options.signal),
  };
}

export function applyTypeaheadResult<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>,
  generation: number,
  result: SuggestionProviderResult<TMetadata>
): TypeaheadState<TMetadata> {
  if (generation !== state.generation) return state;
  const base = {
    ...state,
    providerId: result.providerId,
    requestId: result.requestId ?? state.requestId,
    stale: result.stale,
  };

  switch (result.type) {
    case "success": {
      const items = sortSuggestionItems(result.suggestions);
      return {
        ...base,
        status: items.length === 0 ? "empty" : "open",
        items,
        focusedIndex: items.length === 0 ? undefined : 0,
        error: undefined,
      };
    }
    case "empty":
      return {
        ...base,
        status: "empty",
        items: [],
        focusedIndex: undefined,
        error: undefined,
      };
    case "error":
      return {
        ...base,
        status: "error",
        items: [],
        focusedIndex: undefined,
        error: result.error,
      };
    case "canceled":
      return {
        ...base,
        status: "canceled",
        items: [],
        focusedIndex: undefined,
        error: undefined,
      };
  }
}

export function focusNextSuggestion<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>
): TypeaheadState<TMetadata> {
  if (state.items.length === 0) return state;
  const focusedIndex = state.focusedIndex ?? 0;
  return {
    ...state,
    focusedIndex: (focusedIndex + 1) % state.items.length,
  };
}

export function focusPreviousSuggestion<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>
): TypeaheadState<TMetadata> {
  if (state.items.length === 0) return state;
  const focusedIndex = state.focusedIndex ?? 0;
  return {
    ...state,
    focusedIndex: (focusedIndex - 1 + state.items.length) % state.items.length,
  };
}

export function selectFocusedSuggestion<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>
): TypeaheadUpdate<TMetadata> {
  const item = focusedSuggestion(state);
  if (item === undefined || state.context === undefined) return { state };
  return {
    state,
    intent: {
      type: "replace",
      item,
      replacementText: item.replacementText,
      replacementRange: item.replacementRange,
      nextInput: applySuggestionReplacement(
        state.context.input,
        item.replacementRange,
        item.replacementText
      ),
    },
  };
}

export function dismissTypeahead<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>
): TypeaheadUpdate<TMetadata> {
  return {
    state: {
      ...state,
      status: "dismissed",
      items: [],
      focusedIndex: undefined,
      error: undefined,
    },
    intent: { type: "dismiss" },
  };
}

export function focusedSuggestion<TMetadata = unknown>(
  state: TypeaheadState<TMetadata>
): SuggestionItem<TMetadata> | undefined {
  if (state.focusedIndex === undefined) return undefined;
  return state.items[state.focusedIndex];
}

function sortSuggestionItems<TMetadata>(
  items: readonly SuggestionItem<TMetadata>[]
): readonly SuggestionItem<TMetadata>[] {
  return [...items].sort((a, b) => {
    const priority = (b.rank?.priority ?? 0) - (a.rank?.priority ?? 0);
    if (priority !== 0) return priority;
    const score = (b.rank?.score ?? 0) - (a.rank?.score ?? 0);
    return score;
  });
}

async function resolveProviderResult<TMetadata>(
  provider: SuggestionProvider<TMetadata> | undefined,
  context: SuggestionTokenContext,
  generation: number,
  requestId: string,
  signal: AbortSignal | undefined
): Promise<SuggestionProviderResult<TMetadata>> {
  if (provider === undefined) {
    return normalizeSuggestionProviderResult("none", {
      requestId,
      generation,
    });
  }

  try {
    const result = await provider.getSuggestions(context, signal);
    return {
      ...result,
      requestId: result.requestId ?? requestId,
      generation: result.generation ?? generation,
    };
  } catch (error) {
    return normalizeSuggestionProviderResult(provider.id, {
      requestId,
      generation,
      error: normalizeSuggestionProviderError(error instanceof Error ? error : String(error)),
    });
  }
}
