import { emitKeypressEvents } from "node:readline";
import { createInterface as createPromptInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { buildPickerViewModel } from "../ui/view-models/builders.js";
import type { PickerOption } from "../contracts/view-model.js";
import { createSessionRenderer } from "./session-renderer.js";

export type SelectPromptInput<T> = {
  title: string;
  body?: string;
  instruction?: string;
  selectedLabel?: string;
  options: Array<{
    value: T;
    label: string;
    description?: string;
  }>;
  defaultIndex?: number;
  fallbackPrompt: string;
};

export async function selectOption<T>(input: Readable, output: Writable, selection: SelectPromptInput<T>): Promise<T> {
  const isTty = Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY);

  if (!isTty || selection.options.length === 0) {
    return await plainFallback(input, output, selection);
  }

  return await ttySelect(input, output, selection);
}

async function plainFallback<T>(input: Readable, output: Writable, selection: SelectPromptInput<T>): Promise<T> {
  const renderer = createSessionRenderer({ output: output as NodeJS.WritableStream, mode: "plain" });
  const options: PickerOption[] = selection.options.map((opt, i) => ({
    id: String(i),
    label: opt.label,
    description: opt.description,
    selected: i === (selection.defaultIndex ?? 0),
  }));
  const vm = buildPickerViewModel({ title: selection.title, options });
  output.write(renderer.render(vm) + "\n");
  const raw = await plainQuestion(input, output, selection.fallbackPrompt);
  const selectedIndex = parseChoiceIndex(raw, selection.options.length, selection.defaultIndex ?? 0);
  return selection.options[selectedIndex]?.value ?? selection.options[0]!.value;
}

async function ttySelect<T>(input: Readable, output: Writable, selection: SelectPromptInput<T>): Promise<T> {
  return await new Promise<T>((resolve) => {
    const ttyInput = input as NodeJS.ReadStream;
    let selectedIndex = clampIndex(selection.defaultIndex ?? 0, selection.options.length);
    let settled = false;
    const wasRaw = ttyInput.isRaw === true;
    const saveCursor = "\x1B7";
    const restoreCursor = "\x1B8";
    const clearDown = "\x1B[J";

    const renderer = createSessionRenderer({ output: output as NodeJS.WriteStream });

    const buildOptions = (): PickerOption[] =>
      selection.options.map((opt, i) => ({
        id: String(i),
        label: opt.label,
        description: opt.description,
        selected: i === selectedIndex,
      }));

    const render = () => {
      const vm = buildPickerViewModel({ title: selection.title, options: buildOptions() });
      let text = renderer.render(vm);

      const lines: string[] = [];
      if (selection.body) lines.push(selection.body);
      if (selection.instruction) {
        const useColor = renderer.tokens.contract.behavior.allowAnsiColor;
        lines.push(useColor ? `\x1B[2m${selection.instruction}\x1B[0m` : selection.instruction);
      }
      if (lines.length > 0) {
        text = lines.join("\n") + "\n" + text;
      }

      output.write(`${restoreCursor}${clearDown}`);
      output.write(text);
    };

    const restoreTerminal = () => {
      ttyInput.off("keypress", onKeypress);
      if (!wasRaw) {
        ttyInput.setRawMode(false);
      }
      output.write("\x1B[?25h");
    };

    const finish = (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      restoreTerminal();
      output.write(`\n${selection.selectedLabel ?? "Selected"}: ${selection.options[selectedIndex]?.label ?? "option"}\n\n`);
      resolve(value);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl === true && key.name === "c") {
        restoreTerminal();
        output.write("\n");
        process.emit("SIGINT");
        return;
      }
      if (key.name === "up" || key.name === "k") {
        selectedIndex = selectedIndex <= 0 ? selection.options.length - 1 : selectedIndex - 1;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        selectedIndex = selectedIndex >= selection.options.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(selection.options[selectedIndex]?.value ?? selection.options[0]!.value);
      }
    };

    emitKeypressEvents(ttyInput);
    ttyInput.on("keypress", onKeypress);
    ttyInput.setRawMode(true);
    ttyInput.resume();

    const vm = buildPickerViewModel({ title: selection.title, options: buildOptions() });
    let initialText = renderer.render(vm);
    if (selection.body) initialText = selection.body + "\n" + initialText;
    if (selection.instruction) {
      const useColor = renderer.tokens.contract.behavior.allowAnsiColor;
      initialText = (useColor ? `\x1B[2m${selection.instruction}\x1B[0m` : selection.instruction) + "\n" + initialText;
    }
    const reserveLines = Math.max(1, initialText.split("\n").length - 1);
    output.write("\n".repeat(reserveLines));
    output.write(`\x1B[${reserveLines}A`);
    output.write(`\x1B[?25l${saveCursor}`);
    render();
  });
}

export function parseChoiceIndex(value: string, optionCount: number, defaultIndex: number): number {
  const parsed = Number.parseInt(value, 10) - 1;
  return Number.isFinite(parsed) ? clampIndex(parsed, optionCount) : clampIndex(defaultIndex, optionCount);
}

function clampIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), optionCount - 1);
}

async function plainQuestion(input: Readable, output: Writable, question: string): Promise<string> {
  const readline = createPromptInterface({ input, output });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}
