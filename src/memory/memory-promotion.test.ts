import { describe, expect, it } from "vitest";
import {
  __detectForgetPreferenceForTest,
  __detectProjectFactForTest,
  __detectUserPreferenceForTest,
  __extractPromotionStatementCandidatesForTest
} from "./memory-promotion.js";

describe("memory promotion deterministic detectors", () => {
  it.each([
    ["I prefer TypeScript", "Prefer TypeScript."],
    ["Prefer TypeScript.", "Prefer TypeScript."],
    ["please use pnpm by default", "Prefer pnpm."],
    ["use TypeScript by default", "Prefer TypeScript."],
    ["please use TypeScript by default", "Prefer TypeScript."],
    ["default to TypeScript", "Prefer TypeScript."],
    ["always use strict mode", "Always use strict mode."],
    ["we want pnpm by default", "Want pnpm by default."],
    ["I prefer concise replies", "Prefer concise replies."],
    ["Prefer detailed replies.", "Prefer detailed replies."],
    ["give me detailed replies", "Prefer detailed replies."]
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
    "I'd prefer TypeScript",
    "I like TypeScript",
    "Switch to TypeScript",
    "It would be nice if TypeScript",
    "Maybe use TypeScript",
    "",
    "   \n\t  ",
    "remember this",
    "أفضل الردود المختصرة",
    "For the next release notes, I prefer TypeScript but only inside this quoted example paragraph."
  ])("rejects unsupported or incidental user preference form %j", (input) => {
    expect(__detectUserPreferenceForTest(input)).toBeUndefined();
  });

  it.each([
    "Please summarize this: \"I prefer concise replies.\"",
    "The attached resume says: \"I prefer concise replies.\"",
    "Agent note: I prefer concise replies.",
    "Earlier assistant said: \"User prefers concise replies.\""
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
    "Earlier assistant said: \"User prefers concise replies.\""
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
