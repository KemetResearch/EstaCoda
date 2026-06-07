import { describe, expect, it, vi } from "vitest";
import { findChromiumExecutable } from "./chromium-finder.js";

function pathExistsFor(existingPaths: readonly string[]) {
  const existing = new Set(existingPaths);
  return vi.fn(async (path: string) => existing.has(path));
}

describe("findChromiumExecutable", () => {
  it("uses launchExecutable before every other source", async () => {
    const pathExists = pathExistsFor([
      "/configured/chrome",
      "/env/chrome"
    ]);

    await expect(findChromiumExecutable({
      launchExecutable: "/configured/chrome",
      launchCommand: "/legacy/chrome",
      env: {
        CHROME_PATH: "/env/chrome",
        CHROMIUM_PATH: "/env/chromium"
      },
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toEqual({
      executablePath: "/configured/chrome",
      source: "launchExecutable",
      deprecatedLaunchCommand: undefined,
      warnings: undefined
    });
    expect(pathExists).toHaveBeenCalledTimes(1);
  });

  it("uses launchExecutable only when the path exists", async () => {
    const pathExists = pathExistsFor(["/env/chrome"]);

    await expect(findChromiumExecutable({
      launchExecutable: "/missing/chrome",
      env: { CHROME_PATH: "/env/chrome" },
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/env/chrome",
      source: "env"
    });
    expect(pathExists).toHaveBeenNthCalledWith(1, "/missing/chrome");
    expect(pathExists).toHaveBeenNthCalledWith(2, "/env/chrome");
  });

  it("accepts a single-token launchCommand as deprecated alias data when found", async () => {
    const pathExists = pathExistsFor(["/workspace/google-chrome"]);

    await expect(findChromiumExecutable({
      launchCommand: "google-chrome",
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toEqual({
      executablePath: "/workspace/google-chrome",
      source: "launchCommand",
      deprecatedLaunchCommand: true,
      warnings: undefined
    });
  });

  it("accepts an absolute single-token launchCommand as deprecated alias data when found", async () => {
    const pathExists = pathExistsFor(["/usr/bin/google-chrome"]);

    await expect(findChromiumExecutable({
      launchCommand: "/usr/bin/google-chrome",
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/usr/bin/google-chrome",
      source: "launchCommand",
      deprecatedLaunchCommand: true
    });
  });

  it("does not split or guess shell-like launchCommand values", async () => {
    const pathExists = pathExistsFor([]);

    const result = await findChromiumExecutable({
      launchCommand: "google-chrome --headless",
      cwd: "/workspace",
      platform: "linux",
      pathExists
    });

    expect(result.executablePath).toBeUndefined();
    expect(result.warnings).toEqual([
      "browser.launchCommand is deprecated and was not used because it contains whitespace or shell syntax; use browser.launchExecutable plus browser.launchArgs instead."
    ]);
    expect(pathExists).not.toHaveBeenCalledWith("/workspace/google-chrome");
    expect(pathExists).not.toHaveBeenCalledWith("/workspace/--headless");
  });

  it("uses CHROME_PATH before CHROMIUM_PATH", async () => {
    const pathExists = pathExistsFor([
      "/env/chrome",
      "/env/chromium"
    ]);

    await expect(findChromiumExecutable({
      env: {
        CHROME_PATH: "/env/chrome",
        CHROMIUM_PATH: "/env/chromium"
      },
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/env/chrome",
      source: "env"
    });
    expect(pathExists).toHaveBeenCalledTimes(1);
  });

  it("checks env paths for existence", async () => {
    const pathExists = pathExistsFor(["/env/chromium"]);

    await expect(findChromiumExecutable({
      env: {
        CHROME_PATH: "/missing/chrome",
        CHROMIUM_PATH: "/env/chromium"
      },
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/env/chromium",
      source: "env"
    });
    expect(pathExists).toHaveBeenNthCalledWith(1, "/missing/chrome");
    expect(pathExists).toHaveBeenNthCalledWith(2, "/env/chromium");
  });

  it("checks node_modules/.bin/chromium", async () => {
    const pathExists = pathExistsFor(["/workspace/node_modules/.bin/chromium"]);

    await expect(findChromiumExecutable({
      env: {},
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/workspace/node_modules/.bin/chromium",
      source: "nodeModules"
    });
  });

  it("checks Linux defaults in order", async () => {
    const pathExists = pathExistsFor(["/usr/bin/chromium"]);

    await expect(findChromiumExecutable({
      env: {},
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/usr/bin/chromium",
      source: "platformDefault"
    });
    expect(pathExists.mock.calls.map(([path]) => path)).toEqual([
      "/workspace/node_modules/.bin/chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium"
    ]);
  });

  it("checks macOS app executable paths", async () => {
    const pathExists = pathExistsFor([
      "/Users/test/Applications/Chromium.app/Contents/MacOS/Chromium"
    ]);

    await expect(findChromiumExecutable({
      env: {},
      cwd: "/workspace",
      homeDir: "/Users/test",
      platform: "darwin",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/Users/test/Applications/Chromium.app/Contents/MacOS/Chromium",
      source: "platformDefault"
    });
    expect(pathExists.mock.calls.map(([path]) => path)).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(pathExists.mock.calls.map(([path]) => path)).toContain("/Applications/Chromium.app/Contents/MacOS/Chromium");
  });

  it("checks Windows executable paths without relying on the host OS", async () => {
    const target = "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    const pathExists = pathExistsFor([target]);

    await expect(findChromiumExecutable({
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      cwd: "C:\\workspace",
      platform: "win32",
      pathExists
    })).resolves.toMatchObject({
      executablePath: target,
      source: "platformDefault"
    });
    expect(pathExists).toHaveBeenCalledWith(target);
  });

  it("checks Homebrew paths", async () => {
    const pathExists = pathExistsFor(["/opt/homebrew/bin/chromium"]);

    await expect(findChromiumExecutable({
      env: {},
      cwd: "/workspace",
      platform: "darwin",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/opt/homebrew/bin/chromium",
      source: "homebrew"
    });
  });

  it("checks conservative Docker and bundled paths", async () => {
    const pathExists = pathExistsFor(["/opt/google/chrome/chrome"]);

    await expect(findChromiumExecutable({
      env: {},
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toMatchObject({
      executablePath: "/opt/google/chrome/chrome",
      source: "docker"
    });
  });

  it("returns an undefined executable when nothing exists", async () => {
    const pathExists = pathExistsFor([]);

    await expect(findChromiumExecutable({
      env: {},
      cwd: "/workspace",
      platform: "linux",
      pathExists
    })).resolves.toEqual({ executablePath: undefined });
  });
});
