export const OPENAI_AUDIO_DEFAULT_API_KEY_ENV = "VOICE_TOOLS_OPENAI_KEY";
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

export type ResolvedAudioCredential =
  | { ok: true; apiKey: string; configuredApiKeyEnv: string; sourceApiKeyEnv: string }
  | { ok: false; configuredApiKeyEnv: string; missingApiKeyEnvs: string[] };

export function resolveOpenAiAudioCredential(configuredApiKeyEnv?: string): ResolvedAudioCredential {
  const primaryEnv = configuredApiKeyEnv ?? OPENAI_AUDIO_DEFAULT_API_KEY_ENV;
  const candidates = primaryEnv === OPENAI_AUDIO_DEFAULT_API_KEY_ENV
    ? [primaryEnv, OPENAI_API_KEY_ENV]
    : [primaryEnv, OPENAI_AUDIO_DEFAULT_API_KEY_ENV];

  for (const envName of candidates) {
    const value = process.env[envName];
    if (value !== undefined && value.length > 0) {
      return {
        ok: true,
        apiKey: value,
        configuredApiKeyEnv: primaryEnv,
        sourceApiKeyEnv: envName
      };
    }
  }

  return {
    ok: false,
    configuredApiKeyEnv: primaryEnv,
    missingApiKeyEnvs: candidates
  };
}

export function formatMissingOpenAiAudioCredential(envs: readonly string[]): string {
  return envs.join(" or ");
}
