import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUsableTestPythonBinary } from "./test-python.js";

async function executableScript(name: string, source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "estacoda-test-python-"));
  const path = join(dir, name);
  await writeFile(path, source, "utf8");
  await chmod(path, 0o700);
  return path;
}

describe("resolveUsableTestPythonBinary", () => {
  it("returns a usable candidate", async () => {
    const usable = await executableScript(
      "usable-python",
      "#!/bin/sh\nprintf 'ESTACODA_TEST_PYTHON_OK\\n%s\\n' \"$0\"\n"
    );

    await expect(resolveUsableTestPythonBinary([usable], 1_000)).resolves.toBe(usable);
  });

  it("rejects hanging and failing candidates before returning a later usable candidate", async () => {
    const hanging = await executableScript("hanging-python", "#!/bin/sh\nsleep 5\n");
    const failing = await executableScript("failing-python", "#!/bin/sh\nexit 2\n");
    const usable = await executableScript(
      "usable-python",
      "#!/bin/sh\nprintf 'ESTACODA_TEST_PYTHON_OK\\n%s\\n' \"$0\"\n"
    );

    await expect(resolveUsableTestPythonBinary([hanging, failing, usable], 500)).resolves.toBe(usable);
  });

  it("rejects exit-zero candidates that do not print the Python probe marker", async () => {
    const notPython = await executableScript("not-python", "#!/bin/sh\nexit 0\n");
    const usable = await executableScript(
      "usable-python",
      "#!/bin/sh\nprintf 'ESTACODA_TEST_PYTHON_OK\\n%s\\n' \"$0\"\n"
    );

    await expect(resolveUsableTestPythonBinary([notPython, usable], 1_000)).resolves.toBe(usable);
  });

  it("throws a clear error when no candidate passes the probe", async () => {
    const failing = await executableScript("failing-python", "#!/bin/sh\nexit 2\n");

    await expect(resolveUsableTestPythonBinary([failing], 1_000)).rejects.toThrow(
      /No usable Python interpreter found for tests/
    );
  });
});
