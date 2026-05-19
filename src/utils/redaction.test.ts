import { describe, expect, it } from "vitest";
import { redactJson, redactObject, redactSensitiveText } from "./redaction.js";

describe("redactSensitiveText", () => {
  it("redacts API keys", () => {
    expect(redactSensitiveText("key sk-abcdefghijklmnopqrstuvwxyz123456")).toBe("key [REDACTED]");
  });

  it("redacts bearer tokens", () => {
    expect(redactSensitiveText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456")).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sgn_abcdefghijklmnop";
    expect(redactSensitiveText(`token ${jwt}`)).toBe("token [REDACTED]");
  });

  it("redacts env-style secrets", () => {
    expect(redactSensitiveText("OPENAI_API_KEY=super-secret-value")).toBe("OPENAI_API_KEY=[REDACTED]");
  });

  it("redacts password assignments", () => {
    expect(redactSensitiveText("password: hunter2")).toBe("password: [REDACTED]");
  });

  it("redacts URLs with credentials", () => {
    expect(redactSensitiveText("postgres://user:pass@example.com/db")).toBe("postgres://[REDACTED]:[REDACTED]@example.com/db");
  });

  it("redacts tool-output-like secrets", () => {
    expect(redactSensitiveText("x-api-key: abcdefghijklmnopqrstuvwxyz")).toBe("x-api-key: [REDACTED]");
    expect(redactSensitiveText("client_secret=abcdefghijklmnopqrstuvwxyz")).toBe("client_secret=[REDACTED]");
  });

  it("preserves non-secret text", () => {
    const text = "Build succeeded with 12 warnings and no token usage details.";
    expect(redactSensitiveText(text)).toBe(text);
  });

  it("redacts nested object secret keys and string values", () => {
    expect(redactObject({
      nested: {
        apiKey: "plain-secret",
        output: "Bearer abcdefghijklmnopqrstuvwxyz123456"
      }
    })).toEqual({
      nested: {
        apiKey: "[REDACTED]",
        output: "Bearer [REDACTED]"
      }
    });
  });

  it("redacts JSON text deterministically", () => {
    expect(redactJson('{"token":"abcdefghijklmnopqrstuvwxyz"}')).toBe("{\n  \"token\": \"[REDACTED]\"\n}");
  });
});
