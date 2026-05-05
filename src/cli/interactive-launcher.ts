import { getOnboardingStatus } from "../onboarding/onboarding-flow.js";
import { runInteractiveOnboarding, canRunInteractive, createReadlinePrompt } from "../onboarding/interactive-onboarding.js";
import { kemetBlueTheme } from "../theme/kemet-blue.js";

export type LaunchOptions = {
  workspaceRoot: string;
  homeDir?: string;
};

export type LaunchResult = {
  launched: boolean;
  onboardingTriggered: boolean;
  output: string;
  exitCode: number;
  workspaceRoot?: string;
};

export async function launchInteractiveSession(options: LaunchOptions): Promise<LaunchResult> {
  if (!canRunInteractive()) {
    return {
      launched: false,
      onboardingTriggered: false,
      output: "Interactive session requires a TTY. Use estacoda <prompt> for one-shot mode.",
      exitCode: 1
    };
  }

  const onboarding = await getOnboardingStatus({
    workspaceRoot: options.workspaceRoot,
    homeDir: options.homeDir
  });

  if (onboarding.needed) {
    const prompt = createReadlinePrompt();
    const answer = await prompt(`${onboarding.reason}\nRun setup now? [Y/n]: `);
    prompt.close?.();
    if (answer.trim().length > 0 && !["y", "yes"].includes(answer.trim().toLowerCase())) {
      return {
        launched: false,
        onboardingTriggered: false,
        output: "Setup skipped. Run `estacoda init` to bootstrap state, then `estacoda` when you are ready.",
        exitCode: 0
      };
    }

    const result = await runInteractiveOnboarding({
      workspaceRoot: options.workspaceRoot,
      homeDir: options.homeDir,
      theme: kemetBlueTheme,
      continueToSession: true
    });

    return {
      launched: result.exitCode === 0,
      onboardingTriggered: true,
      output: result.output,
      exitCode: result.exitCode,
      workspaceRoot: result.workspaceRoot
    };
  }

  return {
    launched: true,
    onboardingTriggered: false,
    output: "",
    exitCode: 0
  };
}
