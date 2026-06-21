import { describe, expect, it } from "vitest";
import type { SelectPromptInput } from "../cli/interactive-select.js";
import type { Prompt } from "../cli/readline-prompt.js";
import { isolateLtr, isolateRtl } from "../ui/bidi.js";
import type { SetupVerificationReport } from "./verification.js";
import {
  promptSetupChoice,
  promptSetupYesNo,
  renderSetupApplyEndState,
  setupChoiceColumns,
  setupCopyText,
  setupCsvPromptLabel,
  setupCurrentStatusLine,
  setupNavigationChoice,
  setupPromptLabel,
  setupPromptWithDefault,
  setupProviderCredentialQuestion,
  setupPromptContext,
  setupTelegramAllowedChatIdsQuestion,
  setupTelegramAllowedUserIdsQuestion,
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
    expect(seen?.columns).toBeUndefined();
    expect(seen?.options[0]?.id).toBe("yes");
  });

  it("passes opt-in prompt-card fields through setup choice selectors", async () => {
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
    const statusLine = setupCurrentStatusLine("en", "Alpha");

    const selected = await promptSetupChoice(setupPromptContext(prompt, "en"), {
      title: "Choose mode",
      message: "Pick a mode.\n",
      columns: setupChoiceColumns("en"),
      statusLines: [statusLine],
      hint: "Use arrows.",
      showCurrentBadge: false,
      choices: [
        {
          id: "alpha",
          label: "Alpha",
          description: "First option",
          technical: true,
          cells: { name: "Alpha", description: "First option" },
          badges: ["Recommended"],
          current: true,
          value: "alpha",
        },
        setupNavigationChoice({
          id: "back",
          label: "Back",
          description: "Return to the previous step.",
          value: "back",
        }),
      ],
      defaultValue: "alpha",
    });

    expect(selected).toBe("alpha");
    expect(seen?.columns).toEqual([
      { key: "name", header: "Name" },
      { key: "description", header: "Details" },
    ]);
    expect(seen?.statusLines).toEqual([statusLine]);
    expect(seen?.hint).toBe("Use arrows.");
    expect(seen?.showCurrentBadge).toBe(false);
    expect(seen?.options[0]).toMatchObject({
      id: "alpha",
      label: "Alpha",
      description: "First option",
      technical: true,
      cells: { name: "Alpha", description: "First option" },
      badges: ["Recommended"],
      current: true,
      value: "alpha",
    });
    expect(seen?.options[1]).toMatchObject({
      id: "back",
      group: "navigation",
      value: "back",
    });
  });

  it("keeps simple setup choice callers stacked unless they opt into columns", async () => {
    let seen: SelectPromptInput<boolean> | undefined;
    const prompt = Object.assign(
      async () => "",
      {
        select: async <T>(input: SelectPromptInput<T>): Promise<T> => {
          seen = input as SelectPromptInput<boolean>;
          return input.options[1]!.value;
        },
        close: () => undefined,
      }
    ) as Prompt;

    const selected = await promptSetupYesNo(setupPromptContext(prompt, "en"), {
      title: "Continue",
      message: "Continue?\n",
      yes: { id: "yes", label: "Yes", description: "Continue setup." },
      no: { id: "no", label: "No", description: "Stop here." },
      defaultValue: true,
    });

    expect(selected).toBe(false);
    expect(seen?.columns).toBeUndefined();
    expect(seen?.statusLines).toBeUndefined();
    expect(seen?.hint).toBeUndefined();
    expect(seen?.showCurrentBadge).toBeUndefined();
    expect(seen?.options).toEqual([
      { id: "yes", label: "Yes", description: "Continue setup.", value: true },
      { id: "no", label: "No", description: "Stop here.", value: false },
    ]);
  });

  it("localizes generic setup prompt helper columns and status lines", () => {
    expect(setupChoiceColumns("ar")).toEqual([
      { key: "name", header: "الاسم" },
      { key: "description", header: "التفاصيل" },
    ]);
    expect(setupCurrentStatusLine("ar", "English")).toEqual({
      text: "الحالي: English",
      tone: "active",
      direction: "rtl",
    });
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

    expect(english).toBe("Enter your DeepSeek API key. It will not be shown while you type: ");
    expect(arabic).toBe(isolateRtl(`أدخل مفتاح ${isolateLtr("API")} الخاص بـ ${isolateLtr("DeepSeek")}. لن يظهر أثناء الكتابة: `));
    expect(english).not.toContain("DEEPSEEK_API_KEY");
    expect(arabic).not.toContain("DEEPSEEK_API_KEY");
    expect(setupProviderCredentialQuestion("ar", {
      providerName: "Telegram",
      envVarName: "ESTACODA_TELEGRAM_BOT_TOKEN",
    })).toContain(isolateLtr("Telegram"));
    expect(setupProviderCredentialQuestion("ar", {
      providerName: "Telegram",
      envVarName: "ESTACODA_TELEGRAM_BOT_TOKEN",
    })).not.toContain("ESTACODA_TELEGRAM_BOT_TOKEN");
  });

  it("wraps Arabic raw prompt lines while isolating technical values", () => {
    expect(setupPromptWithDefault("en", "Workspace", "/tmp/example")).toBe("Workspace [/tmp/example]: ");
    expect(setupPromptWithDefault("ar", "اختر مساحة العمل", "/tmp/example")).toBe(
      isolateRtl(`اختر مساحة العمل [${isolateLtr("/tmp/example")}]: `)
    );
    expect(setupPromptLabel("ar", "النموذج")).toBe(isolateRtl("النموذج: "));
    expect(setupCsvPromptLabel("ar", "المستخدمون")).toBe(
      isolateRtl(`المستخدمون, ${isolateLtr("comma-separated")}: `)
    );
  });

  it("wraps Arabic setup apply end-state lines", () => {
    const verification: SetupVerificationReport = {
      stateWritable: true,
      envFilePresent: false,
      envFileSecure: true,
      workspaceTrusted: true,
      securityModeLabel: "Adaptive",
      securityModeValue: "adaptive",
      skillAutonomyLabel: "Suggest",
      skillAutonomyValue: "suggest",
      providerDiagnostic: {
        status: "ready",
        lines: [],
        warnings: [],
      },
      toolStatus: "skipped",
      configSources: [],
      warnings: [],
      issueCodes: [],
    };

    expect(renderSetupApplyEndState({ kind: "verified-ready", verification }, "ar")).toBe(
      isolateRtl(setupCopyText("ar", "setupApply.endState.verifiedReady"))
    );
  });

  it("renders Telegram input prompts from shared setup editor copy without an env-var question", () => {
    expect(setupTelegramBotTokenQuestion("en")).toBe(`${setupCopyText("en", "setupEditor.prompt.telegram.botToken")} `);
    expect(setupTelegramAllowedUserIdsQuestion("en")).toBe(`${setupCopyText("en", "setupEditor.prompt.telegram.allowedUserIds")} `);
    expect(setupTelegramAllowedChatIdsQuestion("en")).toBe(`${setupCopyText("en", "setupEditor.prompt.telegram.allowedChatIds")} `);

    expect(setupTelegramBotTokenQuestion("ar")).toBe(`${isolateRtl(setupCopyText("ar", "setupEditor.prompt.telegram.botToken"))} `);
    expect(setupTelegramAllowedUserIdsQuestion("ar")).toBe(`${isolateRtl(setupCopyText("ar", "setupEditor.prompt.telegram.allowedUserIds"))} `);
    expect(setupTelegramAllowedChatIdsQuestion("ar")).toBe(`${isolateRtl(setupCopyText("ar", "setupEditor.prompt.telegram.allowedChatIds"))} `);
    expect(setupTelegramBotTokenQuestion("ar")).toContain(isolateLtr("Telegram"));
    expect(setupTelegramAllowedUserIdsQuestion("ar")).toContain(isolateLtr("Telegram"));
    expect(setupTelegramAllowedChatIdsQuestion("ar")).toContain(isolateLtr("Telegram"));
  });
});
