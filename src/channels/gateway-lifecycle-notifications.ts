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
