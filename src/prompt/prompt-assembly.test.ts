import { describe, expect, it } from "vitest";
import type { IntentRoute } from "../contracts/intent.js";
import type { ModelProfile, ProviderMessage } from "../contracts/provider.js";
import { assembleProviderPrompt } from "./prompt-assembly.js";

const model: ModelProfile = {
  id: "test-model",
  provider: "test-provider",
  contextWindowTokens: 128_000,
  supportsTools: false,
  supportsVision: false,
  supportsStructuredOutput: false
};

const generalIntent: IntentRoute = {
  nativeIntent: "general",
  labels: ["general"],
  confidence: 1,
  suggestedSkills: [],
  suggestedToolsets: [],
  confirmationRequired: false,
  evidence: [],
  rationale: "No specialized route matched."
};

function renderMessages(messages: ProviderMessage[]): string {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content.map((part) =>
        part.type === "text" ? part.text : ""
      ).join("\n");
    }

    return String(message.content);
  }).join("\n\n");
}

describe("assembleProviderPrompt", () => {
  it("uses direct-response guidance instead of exposing no-skill fallback copy", () => {
    const prompt = assembleProviderPrompt({
      model,
      userText: "What is this project?",
      routedText: "What is this project?",
      selectedSkill: undefined,
      selectedSkillInstructions: undefined,
      selectedSkillResources: undefined,
      selectedSkillSetup: undefined,
      intent: generalIntent,
      securityDecision: "allow",
      toolExecutions: [],
      context: undefined,
      projectContext: undefined,
      memoryContext: undefined,
      providerTools: [],
      fallbackText: "I did not find a matching skill yet. I would answer directly and record this interaction for future skill discovery."
    });

    const rendered = renderMessages(prompt.messages);

    expect(rendered).toContain("Response guidance:");
    expect(rendered).toContain("Answer the user directly using the available context.");
    expect(rendered).not.toContain("Deterministic fallback response if model cannot improve it");
    expect(rendered).not.toMatch(/matching skill/i);
    expect(rendered).not.toMatch(/future skill discovery/i);
    expect(rendered).not.toMatch(/I would answer directly/i);
  });
});
