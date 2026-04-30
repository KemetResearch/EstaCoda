import { emitKeypressEvents } from "node:readline";
import { createInterface as createPromptInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export type SelectPromptInput<T> = {
  title: string;
  body?: string;
  options: Array<{
    value: T;
    label: string;
    description?: string;
  }>;
  defaultIndex?: number;
  fallbackPrompt: string;
};

const SELECTOR_COLORS = {
  selected: ["\x1B[1m\x1B[36m", "\x1B[0m"],
  selectedDescription: ["\x1B[36m", "\x1B[0m"],
  description: ["\x1B[2m", "\x1B[0m"]
} as const;

export async function selectOption<T>(input: Readable, output: Writable, selection: SelectPromptInput<T>): Promise<T> {
  const isTty = Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY);
  if (!isTty || selection.options.length === 0) {
    const raw = await plainQuestion(input, output, selection.fallbackPrompt);
    const selectedIndex = parseChoiceIndex(raw, selection.options.length, selection.defaultIndex ?? 0);
    return selection.options[selectedIndex]?.value ?? selection.options[0]!.value;
  }

  return await new Promise<T>((resolve) => {
    const ttyInput = input as NodeJS.ReadStream;
    let selectedIndex = clampIndex(selection.defaultIndex ?? 0, selection.options.length);
    let settled = false;
    const wasRaw = ttyInput.isRaw === true;
    const saveCursor = "\x1B7";
    const restoreCursor = "\x1B8";
    const clearDown = "\x1B[J";

    const render = () => {
      const columns = (output as NodeJS.WriteStream).columns ?? 100;
      const text = renderSelectFrame(selection, selectedIndex, columns);
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
      output.write(`\nSelected: ${selection.options[selectedIndex]?.label ?? "option"}\n\n`);
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
    const columns = (output as NodeJS.WriteStream).columns ?? 100;
    const reserveLines = Math.max(1, renderSelectFrame(selection, selectedIndex, columns).split("\n").length - 1);
    // Own a stable redraw region. If the menu starts near the bottom, reserve
    // space first so later arrow-key renders do not scroll and duplicate blocks.
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

function renderSelectFrame<T>(selection: SelectPromptInput<T>, selectedIndex: number, columns: number): string {
  const lines = [
    selection.title,
    selection.body,
    "Use ↑/↓ to move, Enter to select.",
    "",
    ...selection.options.flatMap((option, index) => {
      const marker = index === selectedIndex ? "›" : " ";
      const label = index === selectedIndex
        ? color(`${marker} ${option.label}`, "selected")
        : `${marker} ${option.label}`;
      const rendered = [fitLine(label, columns)];
      if (option.description !== undefined && option.description.trim().length > 0) {
        const description = fitLine(`  ${option.description}`, columns);
        rendered.push(index === selectedIndex ? color(description, "selectedDescription") : color(description, "description"));
      }
      return rendered;
    })
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n")}\n`;
}

function fitLine(line: string, columns: number): string {
  const max = Math.max(32, columns - 2);
  const visible = stripAnsi(line);
  if (visible.length <= max) {
    return line;
  }
  const suffix = "…";
  return `${visible.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/gu, "");
}

function color(value: string, kind: keyof typeof SELECTOR_COLORS): string {
  const [open, close] = SELECTOR_COLORS[kind];
  return `${open}${value}${close}`;
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
