import type { LoadedRuntimeConfig } from "../config/runtime-config.js";
import type { DeliveryRouter, DeliveryTarget } from "./delivery-router.js";

export type GatewayLifecycleNotificationLocale = "en" | "ar";

export type GatewayLifecycleNotificationPhase = "shutdown" | "startup";

export type GatewayLifecycleNotificationState = "restarting" | "online";

const GATEWAY_LIFECYCLE_NOTIFICATIONS: Record<
  GatewayLifecycleNotificationLocale,
  Record<GatewayLifecycleNotificationPhase, Partial<Record<GatewayLifecycleNotificationState, string>>>
> = {
  en: {
    shutdown: {
      restarting: "⚠️ EstaCoda: Gateway restarting — running tasks will stop. Send anything after restart to continue from the thread."
    },
    startup: {
      online: "🟢 EstaCoda: Gateway online — agent ready."
    }
  },
  ar: {
    shutdown: {
      restarting: "⚠️ البوابة تُعاد تشغيلها — ستتوقف المهام الجارية. أرسل أي شيء بعد إعادة التشغيل للمتابعة من نفس المحادثة."
    },
    startup: {
      online: "🟢 البوابة متصلة — الوكيل جاهز."
    }
  }
};

export function gatewayLifecycleNotification(input: {
  locale?: string;
  phase: GatewayLifecycleNotificationPhase;
  state: GatewayLifecycleNotificationState;
}): string {
  const locale: GatewayLifecycleNotificationLocale = input.locale === "ar" ? "ar" : "en";
  const message = GATEWAY_LIFECYCLE_NOTIFICATIONS[locale][input.phase][input.state];
  if (message !== undefined) {
    return message;
  }

  const fallback = GATEWAY_LIFECYCLE_NOTIFICATIONS.en[input.phase][input.state];
  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Unsupported gateway lifecycle notification: ${input.phase}/${input.state}`);
}

export type GatewayLifecycleNotificationDeliverySummary = {
  attempted: number;
  delivered: number;
  failed: number;
};

export async function sendGatewayLifecycleNotification(input: {
  router: Pick<DeliveryRouter, "deliverText">;
  config: Pick<LoadedRuntimeConfig, "channels" | "gateway" | "ui">;
  phase: GatewayLifecycleNotificationPhase;
  state: GatewayLifecycleNotificationState;
  logWarning?: (message: string) => void;
}): Promise<GatewayLifecycleNotificationDeliverySummary> {
  if (input.config.gateway.lifecycleNotifications.enabled !== true) {
    return { attempted: 0, delivered: 0, failed: 0 };
  }

  const targets = resolveGatewayLifecycleNotificationTargets(input.config);
  if (targets.length === 0) {
    return { attempted: 0, delivered: 0, failed: 0 };
  }

  const text = gatewayLifecycleNotification({
    locale: input.config.ui.language,
    phase: input.phase,
    state: input.state
  });

  try {
    const results = await input.router.deliverText(targets, text);
    let delivered = 0;
    let failed = 0;
    for (const result of results.values()) {
      if (result.success) {
        delivered += 1;
      } else {
        failed += 1;
      }
    }
    return { attempted: targets.length, delivered, failed };
  } catch (error) {
    input.logWarning?.(`Gateway lifecycle notification failed: ${error instanceof Error ? error.message : String(error)}`);
    return { attempted: targets.length, delivered: 0, failed: targets.length };
  }
}

export function resolveGatewayLifecycleNotificationTargets(
  config: Pick<LoadedRuntimeConfig, "channels">
): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];

  const telegramChatId = config.channels.telegram.ready === true
    ? normalizeNonEmpty(config.channels.telegram.defaultChatId)
    : undefined;
  if (telegramChatId !== undefined) {
    targets.push({ kind: "channel", platform: "telegram", chatId: telegramChatId });
  }

  if (config.channels.discord.ready === true) {
    for (const channelId of config.channels.discord.allowedChannels ?? []) {
      const normalized = normalizeNonEmpty(channelId);
      if (normalized !== undefined) {
        targets.push({ kind: "channel", platform: "discord", chatId: normalized });
      }
    }
  }

  const emailAddress = config.channels.email.ready === true
    ? normalizeNonEmpty(config.channels.email.homeAddress)
    : undefined;
  if (emailAddress !== undefined) {
    targets.push({ kind: "channel", platform: "email", address: emailAddress });
  }

  if (config.channels.whatsapp.ready === true) {
    for (const userId of config.channels.whatsapp.allowedUsers ?? []) {
      const normalized = normalizeNonEmpty(userId);
      if (normalized !== undefined) {
        targets.push({ kind: "channel", platform: "whatsapp", chatId: normalized });
      }
    }
    for (const groupId of config.channels.whatsapp.allowedGroups ?? []) {
      const normalized = normalizeNonEmpty(groupId);
      if (normalized !== undefined) {
        targets.push({ kind: "channel", platform: "whatsapp", chatId: normalized });
      }
    }
  }

  return dedupeTargets(targets);
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function dedupeTargets(targets: DeliveryTarget[]): DeliveryTarget[] {
  const seen = new Set<string>();
  const deduped: DeliveryTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function targetKey(target: DeliveryTarget): string {
  if (target.kind === "channel") {
    return [
      target.kind,
      target.platform,
      target.chatId ?? "",
      target.threadId ?? "",
      target.address ?? ""
    ].join(":");
  }
  return target.kind;
}
