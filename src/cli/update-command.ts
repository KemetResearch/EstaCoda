import {
  checkForUpdate,
  prepareUpdateInfo,
  canApplyUpdate,
  applyUpdate
} from "../lifecycle/update-engine.js";

export type UpdateOptions = {
  dryRun: boolean;
  apply: boolean;
  homeDir?: string;
};

export type UpdateResult = {
  exitCode: number;
  output: string;
};

export async function runUpdateCommand(options: UpdateOptions): Promise<UpdateResult> {
  const homeDir = options.homeDir ?? process.env.HOME ?? "";

  if (homeDir.length === 0) {
    return {
      exitCode: 1,
      output: "Error: HOME is not set. Use --home <dir> or set the HOME environment variable."
    };
  }

  const check = await checkForUpdate();

  if (check.kind === "error") {
    return {
      exitCode: 1,
      output: `Update check failed: ${check.message}`
    };
  }

  if (check.kind === "up-to-date") {
    return {
      exitCode: 2,
      output: `You are on the latest version (${check.current}).`
    };
  }

  const info = check.info;
  const summary = prepareUpdateInfo(info);

  if (!options.apply) {
    return {
      exitCode: 0,
      output: [
        summary,
        "",
        "This was a dry run. No files were modified."
      ].join("\n")
    };
  }

  const test = canApplyUpdate();

  if (!test.testable) {
    return {
      exitCode: 1,
      output: [
        summary,
        "",
        `Cannot apply update: ${test.reason}`
      ].join("\n")
    };
  }

  const artifactPath = process.env.ESTACODA_UPDATE_ARTIFACT!;
  const result = await applyUpdate({ artifactPath, homeDir });

  return {
    exitCode: result.kind === "success" ? 0 : 1,
    output: [
      summary,
      "",
      result.message
    ].join("\n")
  };
}
