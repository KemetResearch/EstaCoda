import type { Runtime } from "../runtime/create-runtime.js";
import { commandRegistry } from "./command-registry.js";
import {
  buildTableViewModel,
  buildListViewModel,
  buildCommandResultViewModel,
  listItem,
} from "../ui/view-models/builders.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { ViewModel } from "../contracts/view-model.js";

// ─────────────────────────────────────────────────────────────
// ViewModel builders (pure data, no rendering)
// ─────────────────────────────────────────────────────────────

export function buildSlashMenuViewModel(runtime: Runtime, filter = ""): ViewModel {
  const normalizedFilter = normalizeFilter(filter);
  const commands = commandRegistry.list({
    scope: "slash",
    filter: normalizedFilter || undefined,
  });

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
  const normalizedFilter = normalizeFilter(filter);
  const grouped = new Map<string, Array<{ name: string; description: string }>>();

  for (const tool of runtime.tools()) {
    if (!matches(normalizedFilter, tool.name, tool.description, ...tool.toolsets)) {
      continue;
    }

    for (const toolset of tool.toolsets) {
      grouped.set(toolset, [
        ...(grouped.get(toolset) ?? []),
        { name: tool.name, description: tool.description },
      ]);
    }
  }

  const blocks: ViewModel[] = [];

  for (const [toolset, rows] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    blocks.push(
      buildTableViewModel({
        title: `${toolset} tools`,
        columns: [
          { key: "name", header: "Name", alignment: "left" },
          { key: "description", header: "Description", alignment: "left" },
        ],
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      })
    );
  }

  if (blocks.length === 0) {
    return buildListViewModel({
      items: [listItem(`No tools match "${normalizedFilter}".`)],
    });
  }

  return buildCommandResultViewModel({
    ok: true,
    title: `Tools: ${runtime.tools().length}`,
    blocks,
  });
}

// ─────────────────────────────────────────────────────────────
// Backward-compatible string wrappers
// ─────────────────────────────────────────────────────────────

export function renderSlashMenu(runtime: Runtime, filter = ""): string {
  return renderPlain(buildSlashMenuViewModel(runtime, filter));
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

function normalizeFilter(value: string): string {
  return value.trim().replace(/^\//u, "").toLowerCase();
}
