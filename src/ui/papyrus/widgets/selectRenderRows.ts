import { stringWidth } from "../screen/stringWidth.js";
import {
  getVisibleOptions,
  type SelectNavigationState,
} from "./selectModel.js";

export type SelectRenderRow<TValue = string> =
  | {
      readonly kind: "option";
      readonly value: TValue;
      readonly label: string;
      readonly width: number;
      readonly description?: string;
      readonly focused: boolean;
      readonly selected: boolean;
      readonly disabled: boolean;
      readonly marker: "focused" | "selected" | "disabled" | "none";
    }
  | {
      readonly kind: "input";
      readonly value: TValue;
      readonly label: string;
      readonly width: number;
      readonly inputValue: string;
      readonly placeholder?: string;
      readonly description?: string;
      readonly focused: boolean;
      readonly selected: boolean;
      readonly disabled: boolean;
      readonly marker: "focused" | "selected" | "disabled" | "none";
    }
  | {
      readonly kind: "empty";
      readonly label: string;
      readonly width: number;
      readonly focused: false;
      readonly selected: false;
      readonly disabled: true;
      readonly marker: "disabled";
    };

export function buildSelectRenderRows<TValue = string, TMetadata = unknown>(
  state: SelectNavigationState<TValue, TMetadata>,
  options: { readonly emptyLabel?: string } = {}
): readonly SelectRenderRow<TValue>[] {
  const visibleOptions = getVisibleOptions(state);
  if (visibleOptions.length === 0) {
    const label = options.emptyLabel ?? "No options";
    return [
      {
        kind: "empty",
        label,
        width: stringWidth(label),
        focused: false,
        selected: false,
        disabled: true,
        marker: "disabled",
      },
    ];
  }

  return visibleOptions.map((option) => {
    const focused = state.focusedValue === option.value;
    const selected = state.selectedValue === option.value;
    const disabled = option.disabled === true;
    const marker = disabled ? "disabled" : focused ? "focused" : selected ? "selected" : "none";
    const common = {
      value: option.value,
      label: option.label,
      width: stringWidth(option.label),
      description: option.description,
      focused,
      selected,
      disabled,
      marker,
    } as const;

    if (option.kind === "input") {
      return {
        ...common,
        kind: "input",
        inputValue: state.inputValues.get(option.value) ?? "",
        placeholder: option.placeholder,
      };
    }

    return {
      ...common,
      kind: "option",
    };
  });
}
