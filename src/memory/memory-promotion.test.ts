import { describe, expect, it } from "vitest";
import {
  __detectForgetPreferenceForTest,
  __detectProjectFactForTest,
  __detectUserPreferenceCandidateForTest,
  __detectUserPreferenceForTest,
  __extractPromotionStatementCandidatesForTest
} from "./memory-promotion.js";

describe("memory promotion deterministic detectors", () => {
  it.each([
    ["I prefer TypeScript", "Prefer TypeScript."],
    ["I'd prefer TypeScript", "Prefer TypeScript."],
    ["My preference is TypeScript", "Prefer TypeScript."],
    ["We prefer TypeScript", "Prefer TypeScript."],
    ["Prefer TypeScript.", "Prefer TypeScript."],
    ["please use pnpm by default", "Prefer pnpm."],
    ["use TypeScript by default", "Prefer TypeScript."],
    ["please use TypeScript by default", "Prefer TypeScript."],
    ["default to TypeScript", "Prefer TypeScript."],
    ["Please switch to TypeScript by default", "Prefer TypeScript."],
    ["always use strict mode", "Always use strict mode."],
    ["we want pnpm by default", "Want pnpm by default."],
    ["I prefer concise replies", "Prefer concise replies."],
    ["Prefer detailed replies.", "Prefer detailed replies."],
    ["give me detailed replies", "Prefer detailed replies."],
    ["أفضل TypeScript", "Prefer TypeScript."],
    ["أفضّل TypeScript", "Prefer TypeScript."],
    ["افضل TypeScript", "Prefer TypeScript."],
    ["استخدم pnpm افتراضياً", "Prefer pnpm."],
    ["استخدم pnpm افتراضيا", "Prefer pnpm."],
    ["استخدم pnpm كافتراضي", "Prefer pnpm."],
    ["خلّي الردود مختصرة", "Prefer concise replies."],
    ["خلي الردود مختصرة", "Prefer concise replies."],
    ["خلّي الردود مفصلة", "Prefer detailed replies."],
    ["خلي الردود مفصلة", "Prefer detailed replies."]
  ])("accepts direct user preference form %j", (input, expected) => {
    expect(__detectUserPreferenceForTest(input)).toBe(expected);
  });

  it.each([
    ["project uses TypeScript", "Project uses TypeScript."],
    ["run tests with pnpm test", "Run tests with `pnpm test`."],
    ["foo is stored under ~/.estacoda/foo", "Foo is stored under `~/.estacoda/foo`."]
  ])("accepts direct project fact form %j", (input, expected) => {
    expect(__detectProjectFactForTest(input)).toBe(expected);
  });

  it.each([
    ["I prefer TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["I'd prefer TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["My preference is TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["We prefer TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["Default to TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["Use TypeScript by default", "language-default", "TypeScript", "language-default:typescript"],
    ["Please switch to TypeScript by default", "language-default", "TypeScript", "language-default:typescript"],
    ["أفضل TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["أفضّل TypeScript", "language-default", "TypeScript", "language-default:typescript"],
    ["I prefer pnpm", "package-manager", "pnpm", "package-manager:pnpm"],
    ["استخدم pnpm افتراضياً", "package-manager", "pnpm", "package-manager:pnpm"],
    ["I prefer pnpm test", "test-command", "pnpm test", "test-command:pnpm test"],
    ["استخدم pnpm test افتراضياً", "test-command", "pnpm test", "test-command:pnpm test"],
    ["always use strict mode", "code-style", "strict mode", "always use strict mode."]
  ])("derives deterministic preference category data for %j", (input, category, value, key) => {
    expect(__detectUserPreferenceCandidateForTest(input)).toMatchObject({
      category,
      value,
      key
    });
  });

  it("does not derive a conflict category for non-canonical want-by-default wording", () => {
    expect(__detectUserPreferenceCandidateForTest("we want pnpm by default")).toMatchObject({
      content: "Want pnpm by default.",
      category: undefined,
      value: "pnpm"
    });
  });

  it("does not derive a code-style category for arbitrary always-use preferences", () => {
    expect(__detectUserPreferenceCandidateForTest("always use GPT-5")).toMatchObject({
      content: "Always use GPT-5.",
      category: undefined,
      value: "GPT-5"
    });
  });

  it.each([
    ["استخدم pnpm test افتراضياً", "Prefer pnpm test."],
    ["استخدم OPENAI_API_KEY كافتراضي", "Prefer OPENAI_API_KEY."],
    ["استخدم ~/.estacoda/foo كافتراضي", "Prefer ~/.estacoda/foo."],
    ["أفضل GPT-5", "Prefer GPT-5."]
  ])("preserves mixed Arabic technical token preference value for %j", (input, expected) => {
    expect(__detectUserPreferenceForTest(input)).toBe(expected);
  });

  it.each([
    "I like TypeScript",
    "Switch to TypeScript",
    "It would be nice if TypeScript",
    "Maybe use TypeScript",
    "Could you use TypeScript",
    "Can we use TypeScript",
    "For this one, use TypeScript",
    "Try TypeScript",
    "",
    "   \n\t  ",
    "remember this",
    "أفضل الردود المختصرة",
    "أفضل لغة آمنة",
    "أفضل safe language",
    "استخدم الردود كافتراضي",
    "استخدم careful release notes كافتراضي",
    "For the next release notes, I prefer TypeScript but only inside this quoted example paragraph."
  ])("rejects unsupported or incidental user preference form %j", (input) => {
    expect(__detectUserPreferenceForTest(input)).toBeUndefined();
  });

  it.each([
    "Please summarize this: \"I prefer concise replies.\"",
    "The attached resume says: \"I prefer concise replies.\"",
    "Agent note: I prefer concise replies.",
    "Earlier assistant said: \"User prefers concise replies.\"",
    "لخّص هذا: \"أفضل TypeScript\"",
    "لخّص هذا: «أفضل TypeScript»",
    "ملاحظة الوكيل: أفضل TypeScript",
    "السيرة تقول: أفضل TypeScript",
    "قال المساعد سابقاً: المستخدم يفضل TypeScript"
  ])("rejects delegated or quoted preference form %j", (input) => {
    expect(__detectUserPreferenceForTest(input)).toBeUndefined();
  });

  it.each([
    ["forget that i prefer concise replies", "Prefer concise replies."],
    ["please forget that i prefer detailed replies", "Prefer detailed replies."]
  ])("keeps explicit forget preference detection deterministic for %j", (input, expected) => {
    expect(__detectForgetPreferenceForTest(input)).toBe(expected);
  });

  it("extracts ordered direct statement candidates from compound user input", () => {
    expect(__extractPromotionStatementCandidatesForTest(
      "I prefer concise replies. Project uses TypeScript."
    )).toEqual([
      {
        text: "I prefer concise replies.",
        source: "direct-user-input",
        index: 0
      },
      {
        text: "Project uses TypeScript.",
        source: "direct-user-input",
        index: 1
      }
    ]);
  });

  it("extracts direct preference candidates that use contractions", () => {
    expect(__extractPromotionStatementCandidatesForTest("I'd prefer TypeScript.")).toEqual([
      {
        text: "I'd prefer TypeScript.",
        source: "direct-user-input",
        index: 0
      }
    ]);
  });

  it.each([
    "My preference is ‘TypeScript’",
    "Please switch to ‘TypeScript’ by default",
    "My preference is “TypeScript”",
    "Please switch to “TypeScript” by default",
    "My preference is „TypeScript‟",
    "Please switch to „TypeScript‟ by default",
    "My preference is ‹TypeScript›",
    "Please switch to ‹TypeScript› by default",
    "My preference is «TypeScript»",
    "Please switch to «TypeScript» by default"
  ])("does not extract typographic quoted promotion candidates from %j", (input) => {
    expect(__extractPromotionStatementCandidatesForTest(input)).toEqual([]);
  });

  it("extracts newline-separated direct statement candidates", () => {
    expect(__extractPromotionStatementCandidatesForTest(
      "I prefer concise replies.\nProject uses TypeScript."
    )).toEqual([
      {
        text: "I prefer concise replies.",
        source: "direct-user-input",
        index: 0
      },
      {
        text: "Project uses TypeScript.",
        source: "direct-user-input",
        index: 1
      }
    ]);
  });

  it.each([
    "Please summarize this: \"I prefer concise replies.\"",
    "The attached resume says: \"I prefer concise replies.\"",
    "Agent note: I prefer concise replies.",
    "Earlier assistant said: \"User prefers concise replies.\"",
    "لخّص هذا: \"أفضل TypeScript\"",
    "لخّص هذا: «أفضل TypeScript»",
    "ملاحظة الوكيل: أفضل TypeScript",
    "السيرة تقول: أفضل TypeScript",
    "قال المساعد سابقاً: المستخدم يفضل TypeScript"
  ])("does not extract delegated or quoted promotion candidates from %j", (input) => {
    const candidates = __extractPromotionStatementCandidatesForTest(input);

    expect(candidates.some((candidate) =>
      __detectUserPreferenceForTest(candidate.text) !== undefined ||
      __detectProjectFactForTest(candidate.text) !== undefined
    )).toBe(false);
  });

  it("does not extract code-blocked promotion candidates", () => {
    expect(__extractPromotionStatementCandidatesForTest([
      "```text",
      "I prefer concise replies.",
      "أفضل TypeScript.",
      "Project uses TypeScript.",
      "```"
    ].join("\n"))).toEqual([]);
  });

  it("does not concatenate around quoted spans into promotion candidates", () => {
    const candidates = __extractPromotionStatementCandidatesForTest(
      "I prefer \"this is only quoted context\" concise replies."
    );

    expect(candidates).toEqual([]);
  });

  it("does not extract inline backticked promotion candidates", () => {
    const candidates = __extractPromotionStatementCandidatesForTest(
      "Project uses `TypeScript`."
    );

    expect(candidates).toEqual([]);
  });

  it("skips long incidental paragraphs that contain preference-like phrases", () => {
    const candidates = __extractPromotionStatementCandidatesForTest(
      "For the release notes and migration guide, this paragraph mentions that I prefer TypeScript only as an example of quoted user research, not as a durable instruction for this project or future sessions."
    );

    expect(candidates).toEqual([]);
  });

  it("skips long incidental Arabic paragraphs that contain preference-like phrases", () => {
    const candidates = __extractPromotionStatementCandidatesForTest(
      "في تقرير طويل عن مقابلات المستخدمين وملاحظات الفريق، وردت عبارة أفضل TypeScript كمثال داخل سياق بحثي وليس كتفضيل دائم أو إعداد افتراضي للمشروع أو الجلسات القادمة."
    );

    expect(candidates).toEqual([]);
  });

  it.each([
    ["U+200B", "\u200b"],
    ["U+200C", "\u200c"],
    ["U+200D", "\u200d"],
    ["U+200E", "\u200e"],
    ["U+200F", "\u200f"],
    ["U+FEFF", "\ufeff"],
    ["U+202A", "\u202a"],
    ["U+202B", "\u202b"],
    ["U+202C", "\u202c"],
    ["U+202D", "\u202d"],
    ["U+202E", "\u202e"],
    ["U+2066", "\u2066"],
    ["U+2067", "\u2067"],
    ["U+2068", "\u2068"],
    ["U+2069", "\u2069"]
  ])("does not extract candidates containing bidi/invisible control %s", (_label, control) => {
    expect(__extractPromotionStatementCandidatesForTest(`أفضل ${control}TypeScript`)).toEqual([]);
  });

  it("bounds direct statement candidate extraction", () => {
    const candidates = __extractPromotionStatementCandidatesForTest(Array.from(
      { length: 12 },
      (_, index) => `Project uses tool ${index}.`
    ).join(" "));

    expect(candidates).toHaveLength(8);
    expect(candidates.map((candidate) => candidate.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(candidates.map((candidate) => candidate.source))).toEqual(new Set(["direct-user-input"]));
  });
});
