import type {
  CommandRegistration,
  CommandRegistry,
} from "../../../../contracts/command-registry.js";
import {
  listSlashCompletionCommands,
  slashCompletionDescription,
} from "../../../slashCompletionSource.js";
import {
  createSuggestionTokenContext,
  normalizeSuggestionProviderResult,
  type SuggestionItem,
  type SuggestionProvider,
  type SuggestionTokenContext,
} from "../suggestionTypes.js";

export const SLASH_COMMAND_SUGGESTION_PROVIDER_ID = "slash-command";

export type SlashCommandSuggestionMetadata = {
  readonly commandName: string;
  readonly aliases: readonly string[];
  readonly category: string;
  readonly availability?: "always" | "active-turn";
  readonly usage?: string;
};

export type SlashCommandSuggestionProviderOptions = {
  readonly registry: CommandRegistry;
  readonly includeActiveTurnCommands?: boolean;
  readonly limit?: number;
};

export function createSlashCommandSuggestionProvider(
  options: SlashCommandSuggestionProviderOptions
): SuggestionProvider<SlashCommandSuggestionMetadata> {
  return {
    id: SLASH_COMMAND_SUGGESTION_PROVIDER_ID,
    name: "Slash commands",
    capabilityTags: ["slash"],
    getSuggestions: (context) => {
      if (!isSlashSuggestionContext(context)) {
        return normalizeSuggestionProviderResult(SLASH_COMMAND_SUGGESTION_PROVIDER_ID);
      }

      const commands = listSlashCompletionCommands(options.registry, context.token, {
        includeActiveTurnCommands: options.includeActiveTurnCommands,
      });
      const limitedCommands = options.limit === undefined ? commands : commands.slice(0, options.limit);

      return normalizeSuggestionProviderResult(SLASH_COMMAND_SUGGESTION_PROVIDER_ID, {
        suggestions: limitedCommands.map((command) => toSuggestionItem(command, context)),
      });
    },
  };
}

export function createSlashSuggestionTokenContext(
  input: string,
  cursorOffset: number
): SuggestionTokenContext | undefined {
  if (!Number.isInteger(cursorOffset) || cursorOffset < 0 || cursorOffset > input.length) {
    return undefined;
  }

  const start = findTokenStart(input, cursorOffset);
  const end = findTokenEnd(input, cursorOffset);
  const token = input.slice(start, end);
  if (!token.startsWith("/")) return undefined;

  return createSuggestionTokenContext({
    input,
    cursorOffset,
    tokenRange: { start, end },
    triggerKind: "slash",
  });
}

function isSlashSuggestionContext(context: SuggestionTokenContext): boolean {
  return context.triggerKind === "slash" && context.token.startsWith("/");
}

function toSuggestionItem(
  command: CommandRegistration,
  context: SuggestionTokenContext
): SuggestionItem<SlashCommandSuggestionMetadata> {
  return {
    id: `slash.${command.name}`,
    label: `/${command.name}`,
    detail: command.usage,
    description: slashCompletionDescription(command.name, "en") ?? command.usage ?? command.description,
    replacementText: `/${command.name}`,
    replacementRange: context.tokenRange,
    providerId: SLASH_COMMAND_SUGGESTION_PROVIDER_ID,
    kind: "slash",
    metadata: {
      commandName: command.name,
      aliases: command.aliases,
      category: command.category,
      availability: command.availability,
      usage: command.usage,
    },
  };
}

function findTokenStart(input: string, cursorOffset: number): number {
  let index = cursorOffset;
  while (index > 0 && !isTokenBoundary(input[index - 1]!)) index -= 1;
  return index;
}

function findTokenEnd(input: string, cursorOffset: number): number {
  let index = cursorOffset;
  while (index < input.length && !isTokenBoundary(input[index]!)) index += 1;
  return index;
}

function isTokenBoundary(char: string): boolean {
  return /\s/u.test(char);
}
