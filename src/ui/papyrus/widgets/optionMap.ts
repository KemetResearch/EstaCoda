export type PapyrusOptionLabel = string;

export type PapyrusOption<TValue = string, TMetadata = unknown> = {
  readonly value: TValue;
  readonly label: PapyrusOptionLabel;
  readonly kind?: "option" | "input";
  readonly description?: string;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly metadata?: TMetadata;
};

export type PapyrusOptionItem<TValue = string, TMetadata = unknown> =
  PapyrusOption<TValue, TMetadata> & {
    readonly index: number;
    readonly previousEnabledValue?: TValue;
    readonly nextEnabledValue?: TValue;
  };

export class DuplicatePapyrusOptionValueError extends Error {
  constructor(value: unknown) {
    super(`Duplicate Papyrus option value: ${String(value)}`);
    this.name = "DuplicatePapyrusOptionValueError";
  }
}

export class PapyrusOptionMap<TValue = string, TMetadata = unknown> {
  readonly items: readonly PapyrusOptionItem<TValue, TMetadata>[];
  readonly enabledItems: readonly PapyrusOptionItem<TValue, TMetadata>[];
  readonly firstEnabled?: PapyrusOptionItem<TValue, TMetadata>;
  readonly lastEnabled?: PapyrusOptionItem<TValue, TMetadata>;

  readonly #byValue = new Map<TValue, PapyrusOptionItem<TValue, TMetadata>>();
  readonly #enabledRankByValue = new Map<TValue, number>();

  constructor(options: readonly PapyrusOption<TValue, TMetadata>[]) {
    const provisionalItems: Array<PapyrusOptionItem<TValue, TMetadata>> = [];
    const enabledIndexes: number[] = [];

    for (const [index, option] of options.entries()) {
      if (this.#byValue.has(option.value)) {
        throw new DuplicatePapyrusOptionValueError(option.value);
      }

      const item: PapyrusOptionItem<TValue, TMetadata> = {
        ...option,
        index,
      };
      provisionalItems.push(item);
      this.#byValue.set(option.value, item);
      if (option.disabled !== true) enabledIndexes.push(index);
    }

    const items = provisionalItems.map((item) => {
      if (item.disabled === true) return item;
      const enabledIndex = enabledIndexes.indexOf(item.index);
      const previousIndex = enabledIndex > 0 ? enabledIndexes[enabledIndex - 1] : undefined;
      const nextIndex = enabledIndex >= 0 && enabledIndex < enabledIndexes.length - 1
        ? enabledIndexes[enabledIndex + 1]
        : undefined;
      return {
        ...item,
        previousEnabledValue: previousIndex === undefined ? undefined : provisionalItems[previousIndex]?.value,
        nextEnabledValue: nextIndex === undefined ? undefined : provisionalItems[nextIndex]?.value,
      };
    });

    for (const item of items) {
      this.#byValue.set(item.value, item);
    }

    this.items = items;
    this.enabledItems = enabledIndexes.map((index, rank) => {
      const item = items[index]!;
      this.#enabledRankByValue.set(item.value, rank);
      return item;
    });
    this.firstEnabled = this.enabledItems[0];
    this.lastEnabled = this.enabledItems[this.enabledItems.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  get enabledSize(): number {
    return this.enabledItems.length;
  }

  get(value: TValue): PapyrusOptionItem<TValue, TMetadata> | undefined {
    return this.#byValue.get(value);
  }

  getEnabledRank(value: TValue): number | undefined {
    return this.#enabledRankByValue.get(value);
  }

  getFirstEnabled(): PapyrusOptionItem<TValue, TMetadata> | undefined {
    return this.firstEnabled;
  }

  getLastEnabled(): PapyrusOptionItem<TValue, TMetadata> | undefined {
    return this.lastEnabled;
  }

  getNextEnabled(
    value: TValue,
    options: { readonly wrap?: boolean } = {}
  ): PapyrusOptionItem<TValue, TMetadata> | undefined {
    const rank = this.#enabledRankByValue.get(value);
    if (rank === undefined) return this.firstEnabled;
    const next = this.enabledItems[rank + 1];
    if (next !== undefined) return next;
    return options.wrap === true ? this.firstEnabled : undefined;
  }

  getPreviousEnabled(
    value: TValue,
    options: { readonly wrap?: boolean } = {}
  ): PapyrusOptionItem<TValue, TMetadata> | undefined {
    const rank = this.#enabledRankByValue.get(value);
    if (rank === undefined) return this.lastEnabled;
    const previous = this.enabledItems[rank - 1];
    if (previous !== undefined) return previous;
    return options.wrap === true ? this.lastEnabled : undefined;
  }
}

export function createOptionMap<TValue = string, TMetadata = unknown>(
  options: readonly PapyrusOption<TValue, TMetadata>[]
): PapyrusOptionMap<TValue, TMetadata> {
  return new PapyrusOptionMap(options);
}
