import { describe, expect, it } from "vitest";
import type { SelectPromptInput } from "../cli/interactive-select.js";
import type { Prompt } from "../cli/readline-prompt.js";
import { isolateLtr } from "../ui/bidi.js";
import {
  promptSetupChoice,
  setupCopyText,
  setupProviderCredentialQuestion,
  setupPromptContext,
  setupTelegramBotTokenEnvQuestion,
  setupTelegramBotTokenQuestion,
} from "./setup-prompts.js";

describe("setup prompt context", () => {
  it("passes Arabic locale and RTL direction to setup choice selectors", async () => {
    let seen: SelectPromptInput<string> | undefined;
    const prompt = Object.assign(
      async () => "",
      {
        select: async <T>(input: SelectPromptInput<T>): Promise<T> => {
          seen = input as SelectPromptInput<string>;
          return input.options[0]!.value;
        },
        close: () => undefined,
      }
    ) as Prompt;

    await promptSetupChoice(setupPromptContext(prompt, "ar"), {
      title: "هل تريد تشغيل EstaCoda الآن؟",
      message: "هل تريد تشغيل EstaCoda الآن؟\n",
      choices: [{ id: "yes", label: "نعم", value: "yes" }],
      defaultValue: "yes",
    });

    expect(seen?.locale).toBe("ar");
    expect(seen?.direction).toBe("rtl");
  });
});

describe("shared setup string prompt copy", () => {
  it("renders provider credential questions from shared setup editor copy", () => {
    const english = setupProviderCredentialQuestion("en", {
      providerName: "DeepSeek",
      envVarName: "DEEPSEEK_API_KEY",
    });
    const arabic = setupProviderCredentialQuestion("ar", {
      providerName: "DeepSeek",
      envVarName: "DEEPSEEK_API_KEY",
    });

    expect(english).toContain(setupCopyText("en", "setupEditor.actions.storeProviderCredentialReference.description"));
    expect(arabic).toContain(setupCopyText("ar", "setupEditor.actions.storeProviderCredentialReference.description"));
    expect(english).toContain("DeepSeek [DEEPSEEK_API_KEY]: ");
    expect(arabic).toContain(`${isolateLtr("DeepSeek")} [${isolateLtr("DEEPSEEK_API_KEY")}]: `);
    expect(arabic).not.toContain("DeepSeek [DEEPSEEK_API_KEY]");
  });

  it("renders Telegram env and secret prompts from shared setup editor copy", () => {
    const english = setupTelegramBotTokenEnvQuestion("en");
    const arabic = setupTelegramBotTokenEnvQuestion("ar");

    expect(english).toContain(setupCopyText("en", "setupEditor.prompt.telegram.summary"));
    expect(english).toContain(setupCopyText("en", "setupEditor.prompt.telegram.botTokenEnv"));
    expect(english).toContain("[ESTACODA_TELEGRAM_BOT_TOKEN]: ");
    expect(arabic).toContain(setupCopyText("ar", "setupEditor.prompt.telegram.summary"));
    expect(arabic).toContain(setupCopyText("ar", "setupEditor.prompt.telegram.botTokenEnv"));
    expect(arabic).toContain(`[${isolateLtr("ESTACODA_TELEGRAM_BOT_TOKEN")}]: `);
    expect(arabic).toContain(isolateLtr("Telegram"));
    expect(arabic).toContain(isolateLtr("EstaCoda"));
    expect(setupTelegramBotTokenQuestion("en")).toBe(`${setupCopyText("en", "setupEditor.prompt.telegram.botToken")}: `);
    expect(setupTelegramBotTokenQuestion("ar")).toBe(`${setupCopyText("ar", "setupEditor.prompt.telegram.botToken")}: `);
  });
});
