import {
  checkForUpdate,
  prepareUpdateInfo,
  canApplyUpdate,
  applyUpdate,
  type UpdateCheckResult
} from "../lifecycle/update-engine.js";
import {
  detectInstallMethod,
  type InstallMethodInfo
} from "../lifecycle/install-method.js";

export type UpdateOptions = {
  dryRun: boolean;
  apply: boolean;
  homeDir?: string;
  installMethodInfo?: InstallMethodInfo;
  detectInstallMethod?: () => Promise<InstallMethodInfo>;
  checkForUpdate?: () => Promise<UpdateCheckResult>;
  canApplyUpdate?: typeof canApplyUpdate;
  applyUpdate?: typeof applyUpdate;
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

  const installMethod = options.installMethodInfo ?? await (options.detectInstallMethod ?? (() => detectInstallMethod({
    includeCwd: false,
    entrypointPath: process.argv[1],
    moduleUrl: import.meta.url
  })))();

  if (!installMethod.canSelfUpdate) {
    return {
      exitCode: options.apply ? 1 : 0,
      output: renderInstallMethodRouting(installMethod, options.apply)
    };
  }

  if (options.apply && installMethod.method === "managed-source") {
    return {
      exitCode: 1,
      output: [
        "Detected install method: managed-source",
        `Reason: ${installMethod.reason}`,
        "",
        "Managed source update apply is planned for PR-I5 and is not active in this build.",
        "No files were modified."
      ].join("\n")
    };
  }

  const check = await (options.checkForUpdate ?? checkForUpdate)();

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

  const test = (options.canApplyUpdate ?? canApplyUpdate)();

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
  const result = await (options.applyUpdate ?? applyUpdate)({ artifactPath, homeDir });

  return {
    exitCode: result.kind === "success" ? 0 : 1,
    output: [
      summary,
      "",
      result.message
    ].join("\n")
  };
}

function renderInstallMethodRouting(info: InstallMethodInfo, apply: boolean): string {
  const lines = [
    apply ? "Update routing" : "Update routing (dry run)",
    `Detected install method: ${info.method}`,
    `Reason: ${info.reason}`,
    `Recommended update command: ${info.recommendedUpdateCommand}`
  ];

  if (info.installDir !== undefined) {
    lines.push(`Install directory: ${info.installDir}`);
  }

  if (info.method === "manual-source") {
    lines.push("Manual source checkouts are not self-mutated by `estacoda update`.");
  }

  if (apply) {
    lines.push("", "No files were modified.");
  } else {
    lines.push("", "This was a dry run. No files were modified.");
  }

  return lines.join("\n");
}
