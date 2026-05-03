import type { EvalCase, EvalResult, EvalReport, EvalAssertion } from "../contracts/eval.js";

export async function runEvalCase(evalCase: EvalCase): Promise<EvalResult> {
  const startedAt = Date.now();

  try {
    return await evalCase.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      id: evalCase.id,
      name: evalCase.name,
      passed: false,
      assertions: [],
      durationMs: Date.now() - startedAt,
      error: message
    };
  }
}

export async function runEvalCases(cases: EvalCase[]): Promise<EvalReport> {
  const startedAt = Date.now();
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    results.push(await runEvalCase(evalCase));
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    results,
    passed,
    failed,
    durationMs: Date.now() - startedAt
  };
}

export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [
    "=== Eval Report ===",
    `Total: ${report.results.length} | Passed: ${report.passed} | Failed: ${report.failed} | Duration: ${report.durationMs}ms`,
    ""
  ];

  for (const result of report.results) {
    const status = result.passed ? "PASS" : "FAIL";
    lines.push(`[${status}] ${result.name} (${result.durationMs}ms)`);

    if (result.error !== undefined) {
      lines.push(`  Error: ${result.error}`);
    }

    for (const assertion of result.assertions) {
      const aStatus = assertion.passed ? "PASS" : "FAIL";
      lines.push(`  [${aStatus}] ${assertion.name}`);
      if (!assertion.passed && assertion.expected !== undefined) {
        lines.push(`    Expected: ${assertion.expected}`);
        lines.push(`    Actual:   ${assertion.actual ?? "undefined"}`);
      }
    }
  }

  lines.push("");
  lines.push(report.failed === 0 ? "All evals passed." : `${report.failed} eval(s) failed.`);

  return lines.join("\n");
}

export function assertEqual<T>(name: string, actual: T, expected: T): EvalAssertion {
  const passed = actual === expected;

  return {
    name,
    passed,
    expected: String(expected),
    actual: passed ? undefined : String(actual)
  };
}

export function assertTrue(name: string, actual: boolean): EvalAssertion {
  return {
    name,
    passed: actual === true,
    expected: "true",
    actual: String(actual)
  };
}

export function assertContains(name: string, haystack: string, needle: string): EvalAssertion {
  const passed = haystack.includes(needle);

  return {
    name,
    passed,
    expected: `contains "${needle}"`,
    actual: passed ? undefined : haystack
  };
}

export function buildResult(
  id: string,
  name: string,
  assertions: EvalAssertion[],
  durationMs: number
): EvalResult {
  const allPassed = assertions.every((a) => a.passed);

  return {
    id,
    name,
    passed: allPassed,
    assertions,
    durationMs
  };
}
