import type { Runtime } from "../runtime/create-runtime.js";
import { commandRegistry } from "./command-registry.js";
import {
  buildTableViewModel,
  buildListViewModel,
  buildCommandResultViewModel,
  buildSlashMenuViewModel as buildSlashCompletionListViewModel,
  listItem,
  slashMenuOption,
} from "../ui/view-models/builders.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { SlashMenuViewModel, ViewModel } from "../contracts/view-model.js";
import type { UiLocale } from "../ui/cli-ui-copy.js";
import {
  isImplementedSlashCommand,
  listSlashCompletionCommands,
  normalizeSlashFilter,
  slashCompletionDescription,
} from "../ui/slashCompletionSource.js";

export {
  isImplementedSlashCommand,
  slashCompletionDescription as completionDescription,
};

// ─────────────────────────────────────────────────────────────
// ViewModel builders (pure data, no rendering)
// ─────────────────────────────────────────────────────────────

const DEFAULT_COMPLETION_LIMIT = 6;
const MENU_DESCRIPTION_MAX_WIDTH = 88;

export function buildSlashCompletionViewModel(
  runtime: Runtime,
  query = "/",
  options: {
    readonly limit?: number;
    readonly visibleRows?: number;
    readonly selectedIndex?: number;
    readonly includeActiveTurnCommands?: boolean;
  } = {}
): SlashMenuViewModel {
  const normalizedFilter = normalizeSlashFilter(query);
  const visibleRows = Math.max(1, options.visibleRows ?? options.limit ?? DEFAULT_COMPLETION_LIMIT);
  const commands = listSlashCompletionCommands(commandRegistry, query, {
    includeActiveTurnCommands: options.includeActiveTurnCommands,
  });
  const totalOptions = commands.length;
  const absoluteSelectedIndex = totalOptions === 0
    ? 0
    : clampIndex(options.selectedIndex ?? 0, totalOptions);
  const visibleStartIndex = computeVisibleStartIndex({
    selectedIndex: absoluteSelectedIndex,
    totalOptions,
    visibleRows,
  });
  const visibleCommands = commands.slice(visibleStartIndex, visibleStartIndex + visibleRows);
  const selectedIndex = totalOptions === 0 ? 0 : absoluteSelectedIndex - visibleStartIndex;

  void runtime;

  return buildSlashCompletionListViewModel({
    query: query.startsWith("/") ? query : `/${query}`,
    options: visibleCommands.map((command) =>
      slashMenuOption(command.name, `/${command.name}`, {
        description: slashCompletionDescription(command.name, "en") ?? command.usage ?? command.description,
      })
    ),
    selectedIndex,
    absoluteSelectedIndex,
    visibleStartIndex,
    totalOptions,
  });
}

export function buildSlashMenuViewModel(runtime: Runtime, filter = ""): ViewModel {
  const normalizedFilter = normalizeSlashFilter(filter);
  const commands = commandRegistry.list({
    scope: "slash",
    filter: normalizedFilter || undefined,
  }).filter((command) => command.availability !== "active-turn");

  const commandRows = commands.map((command) => ({
    name: `/${command.name}`,
    description: command.description,
  }));

  const skillRows = runtime
    .skills()
    .filter((skill) =>
      matches(
        normalizedFilter,
        skill.name,
        skill.description,
        skill.category,
        skill.sourceKind ?? "runtime"
      )
    )
    .map((skill) => ({
      name: `/${skill.name}`,
      description: `${skill.description} [${skill.category}/${skill.sourceKind ?? "runtime"}]`,
    }));

  const blocks: ViewModel[] = [];

  if (commandRows.length > 0) {
    blocks.push(
      buildTableViewModel({
        title: "Commands",
        columns: [
          { key: "name", header: "Name", alignment: "left" },
          { key: "description", header: "Description", alignment: "left" },
        ],
        rows: commandRows,
      })
    );
  }

  if (skillRows.length > 0) {
    blocks.push(
      buildTableViewModel({
        title: "Skills",
        columns: [
          { key: "name", header: "Name", alignment: "left" },
          { key: "description", header: "Description", alignment: "left" },
        ],
        rows: skillRows,
      })
    );
  }

  if (blocks.length === 0) {
    return buildListViewModel({
      items: [listItem(`No slash commands or skills match "/${normalizedFilter}".`)],
    });
  }

  return buildCommandResultViewModel({
    ok: true,
    title: "",
    blocks,
  });
}

export function buildToolsMenuViewModel(runtime: Runtime, filter = ""): ViewModel {
  const normalizedFilter = normalizeSlashFilter(filter);
  const rows = runtime
    .tools()
    .filter((tool) => matches(normalizedFilter, tool.name, tool.description, ...tool.toolsets))
    .map((tool) => ({
      name: tool.name,
      description: truncateMenuDescription(`${tool.description} [${tool.toolsets.join(", ")}]`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) {
    return buildListViewModel({
      items: [
        listItem(
          normalizedFilter.length === 0
            ? "No tools are available."
            : `No tools match "${normalizedFilter}".`
        )
      ],
    });
  }

  return buildCommandResultViewModel({
    ok: true,
    title: `Tools: ${rows.length}`,
    blocks: [
      buildTableViewModel({
        title: "Available tools",
        columns: [
          { key: "name", header: "Name", alignment: "left", emphasis: "strong" },
          { key: "description", header: "Description", alignment: "left" },
        ],
        rows,
      })
    ],
  });
}

export function buildSkillsMenuViewModel(runtime: Runtime, filter = ""): ViewModel {
  const normalizedFilter = normalizeSlashFilter(filter);
  const rows = runtime
    .skills()
    .filter((skill) =>
      matches(
        normalizedFilter,
        skill.name,
        skill.description,
        skill.category ?? "general",
        skill.sourceKind ?? "runtime"
      )
    )
    .map((skill) => ({
      name: `/${skill.name}`,
      description: truncateMenuDescription(
        `${skill.description} [${skill.category ?? "general"}/${skill.sourceKind ?? "runtime"}]`
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (rows.length === 0) {
    return buildListViewModel({
      items: [
        listItem(
          normalizedFilter.length === 0
            ? "No skills are available."
            : `No skills match "${normalizedFilter}".`
        )
      ],
    });
  }

  return buildCommandResultViewModel({
    ok: true,
    title: `Skills: ${rows.length}`,
    blocks: [
      buildTableViewModel({
        title: "Available skills",
        columns: [
          { key: "name", header: "Name", alignment: "left", emphasis: "strong" },
          { key: "description", header: "Description", alignment: "left" },
        ],
        rows,
      })
    ],
  });
}

// ─────────────────────────────────────────────────────────────
// Backward-compatible string wrappers
// ─────────────────────────────────────────────────────────────

export function renderSlashMenu(runtime: Runtime, filter = ""): string {
  return renderPlain(buildSlashMenuViewModel(runtime, filter));
}

export function renderSlashCompletion(runtime: Runtime, query = "/", locale: UiLocale = "en"): string {
  return renderPlain(buildSlashCompletionViewModel(runtime, query), locale);
}

export function renderToolsMenu(runtime: Runtime, filter = ""): string {
  return renderPlain(buildToolsMenuViewModel(runtime, filter));
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function matches(filter: string, ...values: string[]): boolean {
  if (filter.length === 0) {
    return true;
  }

  return values.some((value) => value.toLowerCase().includes(filter));
}

function truncateMenuDescription(value: string): string {
  if (value.length <= MENU_DESCRIPTION_MAX_WIDTH) {
    return value;
  }
  return `${value.slice(0, MENU_DESCRIPTION_MAX_WIDTH - 3).trimEnd()}...`;
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), total - 1);
}

function computeVisibleStartIndex(input: {
  readonly selectedIndex: number;
  readonly totalOptions: number;
  readonly visibleRows: number;
}): number {
  if (input.totalOptions <= input.visibleRows) {
    return 0;
  }
  const maxStartIndex = input.totalOptions - input.visibleRows;
  const centeredStartIndex = input.selectedIndex - Math.floor(input.visibleRows / 2);
  return Math.min(Math.max(0, centeredStartIndex), maxStartIndex);
}
