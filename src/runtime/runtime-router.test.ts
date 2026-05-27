import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { RuntimeRouter } from "./runtime-router.js";
import type { IntentRoute } from "../contracts/intent.js";
import type { SkillDefinition } from "../contracts/skill.js";
import type { IntentRouter } from "./intent-router.js";

function withHomeEnv<T>(env: { HOME?: string; ESTACODA_HOME?: string }, run: () => T): T {
  const previousHome = process.env.HOME;
  const previousEstacodaHome = process.env.ESTACODA_HOME;

  if (env.HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = env.HOME;
  }

  if (env.ESTACODA_HOME === undefined) {
    delete process.env.ESTACODA_HOME;
  } else {
    process.env.ESTACODA_HOME = env.ESTACODA_HOME;
  }

  try {
    return run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousEstacodaHome === undefined) {
      delete process.env.ESTACODA_HOME;
    } else {
      process.env.ESTACODA_HOME = previousEstacodaHome;
    }
  }
}

describe("RuntimeRouter", () => {
  it("expands credential-file tilde paths with OS home, not ESTACODA_HOME", () => {
    const skill: SkillDefinition = {
      name: "credential-test",
      description: "Tests credential path expansion.",
      version: "0.1.0",
      whenToUse: [],
      requiredToolsets: [],
      requiredCredentialFiles: ["~/credentials.json"],
      workflow: [],
      permissionExpectations: [],
      examples: [],
      evaluations: []
    };
    const route: IntentRoute = {
      nativeIntent: "general",
      labels: ["general"],
      confidence: 1,
      suggestedToolsets: [],
      suggestedSkills: [skill],
      confirmationRequired: false,
      evidence: [],
      rationale: "test"
    };
    const intentRouter = {
      route: () => route
    } as unknown as IntentRouter;
    const router = new RuntimeRouter({
      intentRouter,
      skillConfig: {}
    });

    const result = withHomeEnv({
      HOME: "/tmp/prod-home",
      ESTACODA_HOME: "/tmp/dev-home"
    }, () => router.route({ text: "test", channel: "cli" }));

    expect(result.selectedSkillSetup?.requiredCredentialFiles[0]?.resolvedPath)
      .toBe(join("/tmp/prod-home", "credentials.json"));
  });
});
