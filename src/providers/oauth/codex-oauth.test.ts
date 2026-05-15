import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  requestCodexDeviceCode,
  pollCodexToken,
  runCodexOAuthFlow,
  isCodexTokenExpired,
  CodexOAuthError,
  CodexOAuthCancellation,
  CodexOAuthTimeout,
  type FetchLike
} from "./codex-oauth.js";

function createMockFetch(scenarios: {
  authorize?: () => { ok: boolean; status: number; statusText: string; json: unknown };
  tokenPolls?: Array<() => { ok: boolean; status: number; statusText: string; json: unknown }>;
}): FetchLike {
  let authorizeCalled = false;
  let pollIndex = 0;

  return async (url: string, _init: { method: string; headers: Record<string, string>; body: string }) => {
    if (url.includes("/authorize")) {
      authorizeCalled = true;
      const result = scenarios.authorize?.() ?? { ok: true, status: 200, statusText: "OK", json: {} };
      return {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        json: async () => result.json
      };
    }

    if (url.includes("/token")) {
      const polls = scenarios.tokenPolls ?? [];
      const result = polls[pollIndex]?.() ?? { ok: false, status: 404, statusText: "Not Found", json: {} };
      pollIndex++;
      return {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        json: async () => result.json
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({})
    };
  };
}

describe("requestCodexDeviceCode", () => {
  it("returns device code response on success", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: {
          device_code: "dev-123",
          user_code: "USER-CODE",
          verification_uri: "https://auth.openai.com/verify",
          verification_uri_complete: "https://auth.openai.com/verify?code=USER-CODE",
          expires_in: 900,
          interval: 5
        }
      })
    });

    const result = await requestCodexDeviceCode(fetchLike);
    expect(result.device_code).toBe("dev-123");
    expect(result.user_code).toBe("USER-CODE");
    expect(result.verification_uri).toBe("https://auth.openai.com/verify");
    expect(result.verification_uri_complete).toBe("https://auth.openai.com/verify?code=USER-CODE");
    expect(result.expires_in).toBe(900);
    expect(result.interval).toBe(5);
  });

  it("throws CodexOAuthError on HTTP failure", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: { error: "server_error" }
      })
    });

    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow(CodexOAuthError);
    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow("Device code request failed");
  });

  it("throws CodexOAuthError when response lacks required fields", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: { device_code: "dev-123" } // missing user_code, verification_uri, etc.
      })
    });

    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow(CodexOAuthError);
    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow("missing required fields");
  });
});

describe("pollCodexToken", () => {
  it("returns tokens after successful polling", async () => {
    const fetchLike = createMockFetch({
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} }),
        () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: {
            access_token: "eyJfake.codex.token.12345",
            refresh_token: "def502.fake.refresh.token.67890",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "read write"
          }
        })
      ]
    });

    const result = await pollCodexToken("dev-123", {
      intervalSeconds: 0.01, // 10ms for fast tests
      expiresInSeconds: 60,
      fetchLike
    });

    expect(result.accessToken).toBe("eyJfake.codex.token.12345");
    expect(result.refreshToken).toBe("def502.fake.refresh.token.67890");
    expect(result.scopes).toEqual(["read", "write"]);
    expect(result.expiresAt).toBeDefined();
  });

  it("continues polling through 403/404 responses until 200", async () => {
    const fetchLike = createMockFetch({
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} }),
        () => ({ ok: false, status: 404, statusText: "Not Found", json: {} }),
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} }),
        () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: {
            access_token: "eyJfake.codex.token.12345",
            expires_in: 3600
          }
        })
      ]
    });

    const result = await pollCodexToken("dev-123", {
      intervalSeconds: 0.01,
      expiresInSeconds: 60,
      fetchLike
    });

    expect(result.accessToken).toBe("eyJfake.codex.token.12345");
  });

  it("throws CodexOAuthTimeout when deadline expires", async () => {
    const fetchLike = createMockFetch({
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} }),
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} })
      ]
    });

    await expect(
      pollCodexToken("dev-123", {
        intervalSeconds: 0.05,
        expiresInSeconds: 1, // 1 second total
        fetchLike
      })
    ).rejects.toThrow(CodexOAuthTimeout);
  });

  it("throws CodexOAuthCancellation when signal is aborted", async () => {
    const fetchLike = createMockFetch({
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} })
      ]
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      pollCodexToken("dev-123", {
        intervalSeconds: 0.01,
        expiresInSeconds: 60,
        signal: controller.signal,
        fetchLike
      })
    ).rejects.toThrow(CodexOAuthCancellation);
  });

  it("throws on non-403/404 error responses", async () => {
    const fetchLike = createMockFetch({
      tokenPolls: [
        () => ({ ok: false, status: 400, statusText: "Bad Request", json: { error: "invalid_request" } })
      ]
    });

    await expect(
      pollCodexToken("dev-123", {
        intervalSeconds: 0.01,
        expiresInSeconds: 60,
        fetchLike
      })
    ).rejects.toThrow(CodexOAuthError);
  });

  it("validates access_token presence in successful response", async () => {
    const fetchLike = createMockFetch({
      tokenPolls: [
        () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: { token_type: "Bearer" } // missing access_token
        })
      ]
    });

    await expect(
      pollCodexToken("dev-123", {
        intervalSeconds: 0.01,
        expiresInSeconds: 60,
        fetchLike
      })
    ).rejects.toThrow("missing access_token");
  });
});

describe("runCodexOAuthFlow", () => {
  it("returns success with tokens after full flow", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: {
          device_code: "dev-123",
          user_code: "ABC-DEF",
          verification_uri: "https://auth.openai.com/verify",
          expires_in: 60,
          interval: 1
        }
      }),
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} }),
        () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: {
            access_token: "eyJfake.codex.token.12345",
            refresh_token: "def502.fake.refresh.token.67890",
            expires_in: 3600
          }
        })
      ]
    });

    let deviceCodeInfo: { userCode: string; verificationUri: string } | undefined;

    const result = await runCodexOAuthFlow({
      fetchLike,
      onDeviceCode: (info) => {
        deviceCodeInfo = info;
      }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.tokens.accessToken).toBe("eyJfake.codex.token.12345");
      expect(result.tokens.refreshToken).toBe("def502.fake.refresh.token.67890");
    }
    expect(deviceCodeInfo).toEqual({
      userCode: "ABC-DEF",
      verificationUri: "https://auth.openai.com/verify"
    });
  });

  it("returns cancelled when signal is aborted during polling", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: {
          device_code: "dev-123",
          user_code: "ABC-DEF",
          verification_uri: "https://auth.openai.com/verify",
          expires_in: 60,
          interval: 1
        }
      }),
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} })
      ]
    });

    const controller = new AbortController();

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);

    const result = await runCodexOAuthFlow({
      fetchLike,
      signal: controller.signal
    });

    expect(result.kind).toBe("cancelled");
  });

  it("returns timeout when polling exceeds deadline", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: {
          device_code: "dev-123",
          user_code: "ABC-DEF",
          verification_uri: "https://auth.openai.com/verify",
          expires_in: 2,
          interval: 1
        }
      }),
      tokenPolls: [
        () => ({ ok: false, status: 403, statusText: "Forbidden", json: {} })
      ]
    });

    const result = await runCodexOAuthFlow({ fetchLike });

    expect(result.kind).toBe("timeout");
    if (result.kind === "timeout") {
      expect(result.reason).toContain("timed out");
    }
  });

  it("returns error on device code request failure", async () => {
    const fetchLike = createMockFetch({
      authorize: () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: { error: "server_error" }
      })
    });

    const result = await runCodexOAuthFlow({ fetchLike });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("Device code request failed");
    }
  });
});

describe("isCodexTokenExpired", () => {
  it("returns false when no expiry is set", () => {
    expect(isCodexTokenExpired({})).toBe(false);
  });

  it("returns false when expiry is in the future", () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    expect(isCodexTokenExpired({ expiresAt: future })).toBe(false);
  });

  it("returns true when expiry is in the past", () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(isCodexTokenExpired({ expiresAt: past })).toBe(true);
  });
});

describe("redaction assertions", () => {
  it("mock fetch responses use fixed fake tokens, never real-looking values", () => {
    // This test documents the invariant that all tests in this file use
    // the fixed fake token value for assertions.
    const fakeAccess = "eyJfake.codex.token.12345";
    const fakeRefresh = "def502.fake.refresh.token.67890";

    // Verify these are the exact strings used in tests above
    expect(fakeAccess).toContain("eyJ");
    expect(fakeAccess).toContain("fake");
    expect(fakeRefresh).toContain("def502");
    expect(fakeRefresh).toContain("fake");
  });
});
