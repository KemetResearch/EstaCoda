import type { CliCommandResult, CliOptions } from "./cli.js";
import { runEvalCases, formatEvalReport } from "../eval/eval-runner.js";
import { defaultEvalFixtures } from "../eval/fixtures/index.js";

export async function evalCommand(_options: CliOptions, args: string[]): Promise<CliCommandResult> {
  const fixtureId = args[0];
  const cases = fixtureId === undefined
    ? defaultEvalFixtures
    : defaultEvalFixtures.filter((c) => c.id === fixtureId);

  if (cases.length === 0) {
    return {
      handled: true,
      exitCode: 1,
      output: `Unknown fixture: ${fixtureId}\nAvailable: ${defaultEvalFixtures.map((c) => c.id).join(", ")}`
    };
  }

  const report = await runEvalCases(cases);
  const output = formatEvalReport(report);

  return {
    handled: true,
    exitCode: report.failed === 0 ? 0 : 1,
    output
  };
}
