import { describe, expect, it } from "vitest";
import { gatewayLifecycleNotification } from "./gateway-lifecycle-notifications.js";

describe("gatewayLifecycleNotification", () => {
  it("returns exact English shutdown restarting copy", () => {
    expect(gatewayLifecycleNotification({
      locale: "en",
      phase: "shutdown",
      state: "restarting"
    })).toBe("⚠️ EstaCoda: Gateway restarting — running tasks will stop. Send anything after restart to continue from the thread.");
  });

  it("returns exact English startup online copy", () => {
    expect(gatewayLifecycleNotification({
      locale: "en",
      phase: "startup",
      state: "online"
    })).toBe("🟢 EstaCoda: Gateway online — agent ready.");
  });

  it("returns exact Arabic shutdown restarting copy", () => {
    expect(gatewayLifecycleNotification({
      locale: "ar",
      phase: "shutdown",
      state: "restarting"
    })).toBe("⚠️ البوابة تُعاد تشغيلها — ستتوقف المهام الجارية. أرسل أي شيء بعد إعادة التشغيل للمتابعة من نفس المحادثة.");
  });

  it("returns exact Arabic startup online copy", () => {
    expect(gatewayLifecycleNotification({
      locale: "ar",
      phase: "startup",
      state: "online"
    })).toBe("🟢 البوابة متصلة — الوكيل جاهز.");
  });

  it("omits the EstaCoda prefix from Arabic copy", () => {
    expect(gatewayLifecycleNotification({
      locale: "ar",
      phase: "shutdown",
      state: "restarting"
    })).not.toContain("EstaCoda:");
    expect(gatewayLifecycleNotification({
      locale: "ar",
      phase: "startup",
      state: "online"
    })).not.toContain("EstaCoda:");
  });
});
