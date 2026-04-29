import type { ChannelAttachment, ChannelMessage } from "../contracts/channel.js";
import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import { transcribeAudioFile, type VoiceFetchLike } from "../tools/voice-tools.js";

export type ChannelVoiceTranscriptionOptions = {
  stt: LoadedRuntimeConfig["stt"];
  fetch?: VoiceFetchLike;
};

export async function injectVoiceTranscripts(
  message: ChannelMessage,
  options: ChannelVoiceTranscriptionOptions
): Promise<ChannelMessage> {
  const attachments = (message.attachments ?? []).filter(isReadyVoiceAttachment);
  if (attachments.length === 0) {
    return message;
  }

  const notes: string[] = [];
  for (const attachment of attachments) {
    const path = attachment.localPath ?? attachment.path;
    if (path === undefined || path.length === 0) {
      continue;
    }

    const result = await transcribeAudioFile({
      path,
      stt: options.stt,
      fetch: options.fetch
    });
    if (result.ok) {
      notes.push(`[Voice transcript from ${attachmentLabel(attachment)}]\n${result.text}`);
    } else {
      notes.push(`[Voice transcript unavailable for ${attachmentLabel(attachment)}]\n${result.content}`);
    }
  }

  if (notes.length === 0) {
    return message;
  }

  return {
    ...message,
    text: [message.text.trim(), ...notes].filter((part) => part.length > 0).join("\n\n"),
    metadata: {
      ...(message.metadata ?? {}),
      voiceTranscription: {
        injected: true,
        count: notes.length
      }
    }
  };
}

function isReadyVoiceAttachment(attachment: ChannelAttachment): boolean {
  return (attachment.kind === "audio" || attachment.kind === "voice") &&
    (attachment.status === undefined || attachment.status === "ready");
}

function attachmentLabel(attachment: ChannelAttachment): string {
  return attachment.originalName ?? attachment.name ?? attachment.id;
}
