import { commandRegistry } from "./command-registry.js";
import {
  buildListViewModel,
  listItem,
} from "../ui/view-models/builders.js";
import { renderPlain } from "../ui/renderers/plain-renderer.js";
import type { ViewModel } from "../contracts/view-model.js";

// ViewModel builder (pure data, no rendering)
export function buildSessionHelpViewModel(): ViewModel {
  const commands = commandRegistry.list({ scope: "slash" });

  return buildListViewModel({
    title: "EstaCoda session commands",
    items: commands.map((command) =>
      listItem(`/${command.name}`, command.description)
    ),
  });
}

// Backward-compatible string wrapper
export function renderSessionHelp(): string {
  return renderPlain(buildSessionHelpViewModel());
}
