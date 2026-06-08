import type { RegisteredTool, StaticToolProvider } from "../contracts/tool.js";

export const builtinTools: readonly RegisteredTool[] = [
  {
    name: "playbook.plan",
    description: "Create a concise execution plan for a selected skill playbook.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string" },
          intent: { type: "array", items: { type: "string" } },
          firstStep: { type: "string" },
          playbookStep: { type: "string" },
          stepDescription: { type: "string" },
          previousResults: { type: "array", items: { type: "string" } }
        },
        required: ["skill"]
    },
    riskClass: "read-only-local",
    toolsets: ["core", "research"],
    progressLabel: "planning playbook",
    maxResultSizeChars: 4000,
    isAvailable: () => true,
    run: async (input: {
      skill?: string;
      intent?: string[];
      firstStep?: string;
      playbookStep?: string;
      stepDescription?: string;
      previousResults?: string[];
    }) => ({
      ok: true,
      content: [
        `Prepared playbook for ${input.skill ?? "selected skill"}.`,
        input.intent === undefined ? undefined : `Intent: ${input.intent.join(", ")}`,
        input.firstStep === undefined ? undefined : `First step: ${input.firstStep}`,
        input.playbookStep === undefined ? undefined : `Playbook step: ${input.playbookStep}`,
        input.stepDescription === undefined ? undefined : `Step goal: ${input.stepDescription}`,
        input.previousResults === undefined || input.previousResults.length === 0
          ? undefined
          : `Previous results: ${input.previousResults.length}`
      ]
        .filter((line) => line !== undefined)
        .join("\n")
    })
  },
  {
    name: "trajectory.record",
    description: "Record agent trajectory events for evaluation and future learning.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string" },
        data: { type: "object" }
      },
      required: ["kind", "data"]
    },
    riskClass: "read-only-local",
    toolsets: ["core", "research"],
    progressLabel: "recording trajectory",
    maxResultSizeChars: 2000,
    isAvailable: () => true,
    run: async () => ({
      ok: true,
      content: "trajectory.record is scaffolded; runtime event capture is handled by TrajectoryRecorder."
    })
  }
];

export const builtinToolProvider: StaticToolProvider = {
  name: "builtin",
  kind: "static",
  tools: builtinTools
};
