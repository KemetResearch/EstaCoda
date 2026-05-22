import { stat } from "node:fs/promises";
import { extname } from "node:path";

export const DEFAULT_AUDIO_INPUT_MAX_BYTES = 25 * 1024 * 1024;

export type AudioValidationResult =
  | { ok: true; bytes: number }
  | { ok: false; content: string; metadata: { reason: string; path?: string; maxBytes?: number; bytes?: number } };

export async function validateAudioInput(
  path: string,
  options: {
    maxBytes?: number;
    allowedExtensions?: readonly string[];
  } = {}
): Promise<AudioValidationResult> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    return validationError(`Audio file does not exist: ${path}`, { path });
  }

  if (!fileStat.isFile()) {
    return validationError(`Audio path is not a file: ${path}`, { path });
  }

  const maxBytes = options.maxBytes ?? DEFAULT_AUDIO_INPUT_MAX_BYTES;
  if (fileStat.size > maxBytes) {
    return validationError(`Audio file exceeds max size of ${maxBytes} bytes.`, {
      path,
      maxBytes,
      bytes: fileStat.size
    });
  }

  const allowedExtensions = options.allowedExtensions ?? DEFAULT_AUDIO_EXTENSIONS;
  const extension = extname(path).toLowerCase();
  if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
    return validationError(`Audio file type is not supported: ${extension || "unknown"}`, { path });
  }

  return { ok: true, bytes: fileStat.size };
}

export function validateAudioOutput(
  bytes: Buffer,
  options: { provider: string }
): AudioValidationResult {
  if (bytes.length === 0) {
    return validationError(`${options.provider} TTS returned empty audio.`, {
      bytes: 0
    });
  }
  return { ok: true, bytes: bytes.length };
}

const DEFAULT_AUDIO_EXTENSIONS = [
  ".aac",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".oga",
  ".ogg",
  ".opus",
  ".pcm",
  ".wav",
  ".webm"
] as const;

function validationError(
  content: string,
  metadata: Omit<Extract<AudioValidationResult, { ok: false }>["metadata"], "reason">
): Extract<AudioValidationResult, { ok: false }> {
  return {
    ok: false,
    content,
    metadata: {
      reason: content,
      ...metadata
    }
  };
}
