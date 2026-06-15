import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_PROBE_TIMEOUT_MS = 1_000;
const PYTHON_PROBE_MARKER = "ESTACODA_TEST_PYTHON_OK";
const PYTHON_PROBE_CODE = `import sys; print(${JSON.stringify(PYTHON_PROBE_MARKER)}); print(sys.executable)`;

let cachedPythonBinary: string | undefined;

export async function resolveTestPythonBinary(): Promise<string> {
  if (cachedPythonBinary !== undefined) {
    return cachedPythonBinary;
  }

  const codexRuntimeHome = process.env.CODEX_SQLITE_HOME === undefined
    ? undefined
    : dirname(dirname(process.env.CODEX_SQLITE_HOME));
  const candidateHomes = [codexRuntimeHome, process.env.HOME, homedir()]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const candidates = uniqueCandidates([
    process.env.ESTACODA_TEST_PYTHON_BINARY,
    ...candidateHomes.map((home) =>
      join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python3")
    ),
    "python3",
  ]);

  cachedPythonBinary = await resolveUsableTestPythonBinary(candidates);
  return cachedPythonBinary;
}

export async function resolveUsableTestPythonBinary(
  candidates: readonly string[],
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
): Promise<string> {
  for (const candidate of candidates) {
    if (candidate !== "python3") {
      try {
        if (!existsSync(candidate)) {
          continue;
        }
      } catch {
        continue;
      }
    }

    if (await probePythonCandidate(candidate, timeoutMs)) {
      return candidate;
    }
  }

  throw new Error(
    `No usable Python interpreter found for tests. Tried: ${candidates.length === 0 ? "(none)" : candidates.join(", ")}`
  );
}

export function resetTestPythonBinaryCache(): void {
  cachedPythonBinary = undefined;
}

function uniqueCandidates(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

async function probePythonCandidate(candidate: string, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const child = spawn(candidate, ["-c", PYTHON_PROBE_CODE], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timeout = setTimeout(() => {
      finish(false);
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && isValidPythonProbeOutput(stdout)));

    function finish(ok: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    }
  });
}

function isValidPythonProbeOutput(stdout: string): boolean {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
  const markerIndex = lines.indexOf(PYTHON_PROBE_MARKER);
  if (markerIndex < 0) {
    return false;
  }
  const executable = lines[markerIndex + 1];
  return typeof executable === "string" && executable.length > 0;
}
