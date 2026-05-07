import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type InitOptions = {
  homeDir?: string;
  yes?: boolean;
};

export type InitResult = {
  ok: boolean;
  output: string;
  exitCode: number;
};

export const DEFAULT_STATE_DIRS = [
  "memory",
  "skills",
  "skills/local",
  "skills/.evolution",
  "packs",
  "cron",
  ".backups"
];

export async function bootstrapStateDirectories(homeDir: string): Promise<void> {
  const root = join(homeDir, ".estacoda");
  for (const dir of DEFAULT_STATE_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }
}

export async function runInitCommand(options: InitOptions): Promise<InitResult> {
  const homeDir = options.homeDir ?? process.env.HOME ?? "";
  if (homeDir.length === 0) {
    return {
      ok: false,
      output: "Error: HOME is not set. Use --home <dir> to specify a home directory.",
      exitCode: 1
    };
  }

  const root = join(homeDir, ".estacoda");

  try {
    await bootstrapStateDirectories(homeDir);

    const configPath = join(root, "config.json");
    if (!existsSync(configPath)) {
      const defaultConfig = {
        model: {
          provider: "unconfigured",
          id: "unconfigured"
        },
        providers: {},
        skills: {
          autonomy: "suggest"
        },
        ui: {
          language: "en",
          flavor: "standard",
          activityLabels: "en"
        },
        security: {
          approvalMode: "confirm"
        }
      };
      await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
    }

    const trustPath = join(root, "trust.json");
    if (!existsSync(trustPath)) {
      await writeFile(trustPath, "{}\n", "utf8");
    }

    const sessionsPath = join(root, "sessions.sqlite");
    if (!existsSync(sessionsPath)) {
      await writeFile(sessionsPath, "", "utf8");
    }

    return {
      ok: true,
      output: [
        "EstaCoda state initialized.",
        `Home: ${root}`,
        "Created:",
        ...DEFAULT_STATE_DIRS.map((d) => `  ${d}/`),
        "  config.json",
        "  trust.json",
        "  sessions.sqlite",
        "",
        "Next: run `estacoda` to start interactive setup, or `estacoda verify` to check readiness."
      ].join("\n"),
      exitCode: 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error initializing state: ${message}`,
      exitCode: 1
    };
  }
}
