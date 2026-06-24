import { describe, expect, it } from "vitest";
import {
  requestCodexDeviceCode,
  pollCodexAuthorizationCode,
  exchangeCodexAuthorizationCode,
  runCodexOAuthFlow,
  isCodexTokenExpired,
  CodexOAuthError,
  CodexOAuthCancellation,
  CodexOAuthTimeout,
  type FetchLike
} from "./codex-oauth.js";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

type MockResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: unknown;
};

type FetchCall = {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  };
};

function response(json: unknown, overrides?: Partial<Omit<MockResponse, "json">>): MockResponse {
  return {
    ok: overrides?.ok ?? true,
    status: overrides?.status ?? 200,
    statusText: overrides?.statusText ?? "OK",
    json
  };
}

function createMockFetch(scenarios: {
  usercode?: () => MockResponse;
  authorizationPolls?: Array<() => MockResponse>;
  tokenExchange?: () => MockResponse;
}): { fetchLike: FetchLike; calls: FetchCall[] } {
  let pollIndex = 0;
  const calls: FetchCall[] = [];

  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, init });

    if (url.endsWith("/api/accounts/deviceauth/usercode")) {
      const result = scenarios.usercode?.() ?? response({});
      return toFetchResponse(result);
    }

    if (url.endsWith("/api/accounts/deviceauth/token")) {
      const polls = scenarios.authorizationPolls ?? [];
      const result = polls[pollIndex]?.() ?? response({}, {
        ok: false,
        status: 404,
        statusText: "Not Found"
      });
      pollIndex++;
      return toFetchResponse(result);
    }

    if (url.endsWith("/oauth/token")) {
      const result = scenarios.tokenExchange?.() ?? response({});
      return toFetchResponse(result);
    }

    return toFetchResponse(response({}, {
      ok: false,
      status: 404,
      statusText: "Not Found"
    }));
  };

  return { fetchLike, calls };
}

function toFetchResponse(result: MockResponse): Awaited<ReturnType<FetchLike>> {
  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    json: async () => result.json
  };
}

describe("requestCodexDeviceCode", () => {
  it("posts JSON to the Codex usercode endpoint and parses the response", async () => {
    const { fetchLike, calls } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret",
        interval: 7
      })
    });

    const result = await requestCodexDeviceCode(fetchLike);

    expect(result).toEqual({
      user_code: "ABC-DEF",
      device_auth_id: "device-auth-secret",
      interval: 7
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ client_id: CODEX_CLIENT_ID }));
  });

  it("defaults the poll interval when the server omits it", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret"
      })
    });

    const result = await requestCodexDeviceCode(fetchLike);

    expect(result.interval).toBe(5);
  });

  it("coerces string interval to a number (OpenAI returns \"5\" not 5)", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret",
        interval: "7"
      })
    });

    const result = await requestCodexDeviceCode(fetchLike);

    expect(result.interval).toBe(7);
  });

  it("handles expires_at ISO timestamp when expires_in is absent", async () => {
    const future = new Date(Date.now() + 900 * 1000).toISOString();
    const { fetchLike } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret",
        interval: "5",
        expires_at: future
      })
    });

    const result = await requestCodexDeviceCode(fetchLike);

    expect(result.expires_in).toBeDefined();
    expect(result.expires_in).toBeGreaterThanOrEqual(899);
    expect(result.expires_in).toBeLessThanOrEqual(901);
  });

  it("throws CodexOAuthError on HTTP failure without exposing response body fields", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response(
        {
          error: "server_error",
          device_auth_id: "device-auth-secret",
          authorization_code: "authorization-code-secret"
        },
        { ok: false, status: 500, statusText: "Internal Server Error" }
      )
    });

    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow(CodexOAuthError);
    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow("Device code request failed");
    await expect(requestCodexDeviceCode(fetchLike)).rejects.not.toThrow("device-auth-secret");
    await expect(requestCodexDeviceCode(fetchLike)).rejects.not.toThrow("authorization-code-secret");
  });

  it("throws CodexOAuthError when response lacks required fields", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response({ user_code: "ABC-DEF" })
    });

    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow(CodexOAuthError);
    await expect(requestCodexDeviceCode(fetchLike)).rejects.toThrow("missing required fields");
  });
});

describe("pollCodexAuthorizationCode", () => {
  it("posts JSON with device auth id and user code, then parses authorization fields", async () => {
    const { fetchLike, calls } = createMockFetch({
      authorizationPolls: [
        () => response({
          authorization_code: "authorization-code-secret",
          code_verifier: "code-verifier-secret"
        })
      ]
    });

    const result = await pollCodexAuthorizationCode("device-auth-secret", "ABC-DEF", {
      intervalSeconds: 0,
      timeoutMs: 1000,
      fetchLike
    });

    expect(result).toEqual({
      authorization_code: "authorization-code-secret",
      code_verifier: "code-verifier-secret"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://auth.openai.com/api/accounts/deviceauth/token");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]?.init.body).toBe(JSON.stringify({
      device_auth_id: "device-auth-secret",
      user_code: "ABC-DEF"
    }));
  });

  it("continues polling through 403/404 responses until authorized", async () => {
    const { fetchLike, calls } = createMockFetch({
      authorizationPolls: [
        () => response({}, { ok: false, status: 403, statusText: "Forbidden" }),
        () => response({}, { ok: false, status: 404, statusText: "Not Found" }),
        () => response({
          authorization_code: "authorization-code-secret",
          code_verifier: "code-verifier-secret"
        })
      ]
    });

    const result = await pollCodexAuthorizationCode("device-auth-secret", "ABC-DEF", {
      intervalSeconds: 0,
      timeoutMs: 1000,
      fetchLike
    });

    expect(result.authorization_code).toBe("authorization-code-secret");
    expect(calls).toHaveLength(3);
  });

  it("throws CodexOAuthTimeout when deadline expires", async () => {
    const { fetchLike } = createMockFetch({
      authorizationPolls: [
        () => response({}, { ok: false, status: 403, statusText: "Forbidden" })
      ]
    });

    await expect(
      pollCodexAuthorizationCode("device-auth-secret", "ABC-DEF", {
        intervalSeconds: 0,
        timeoutMs: 0,
        fetchLike
      })
    ).rejects.toThrow(CodexOAuthTimeout);
  });

  it("throws CodexOAuthCancellation when signal is aborted", async () => {
    const { fetchLike } = createMockFetch({
      authorizationPolls: [
        () => response({}, { ok: false, status: 403, statusText: "Forbidden" })
      ]
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      pollCodexAuthorizationCode("device-auth-secret", "ABC-DEF", {
        intervalSeconds: 0,
        timeoutMs: 1000,
        signal: controller.signal,
        fetchLike
      })
    ).rejects.toThrow(CodexOAuthCancellation);
  });

  it("throws on unexpected non-pending responses without exposing sensitive body fields", async () => {
    const { fetchLike } = createMockFetch({
      authorizationPolls: [
        () => response(
          {
            error: "invalid_request",
            device_auth_id: "device-auth-secret",
            authorization_code: "authorization-code-secret",
            code_verifier: "code-verifier-secret"
          },
          { ok: false, status: 400, statusText: "Bad Request" }
        )
      ]
    });

    let caught: unknown;
    try {
      await pollCodexAuthorizationCode("device-auth-secret", "ABC-DEF", {
        intervalSeconds: 0,
        timeoutMs: 1000,
        fetchLike
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CodexOAuthError);
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).not.toContain("authorization-code-secret");
      expect(caught.message).not.toContain("code-verifier-secret");
    }
  });

  it("validates authorization_code and code_verifier presence", async () => {
    const { fetchLike } = createMockFetch({
      authorizationPolls: [
        () => response({ authorization_code: "authorization-code-secret" })
      ]
    });

    await expect(
      pollCodexAuthorizationCode("device-auth-secret", "ABC-DEF", {
        intervalSeconds: 0,
        timeoutMs: 1000,
        fetchLike
      })
    ).rejects.toThrow("Authorization response missing required fields");
  });
});

describe("exchangeCodexAuthorizationCode", () => {
  it("posts form-encoded authorization code exchange and parses tokens", async () => {
    const { fetchLike, calls } = createMockFetch({
      tokenExchange: () => response({
        access_token: "eyJfake.codex.token.12345",
        refresh_token: "def502.fake.refresh.token.67890",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "read write"
      })
    });

    const result = await exchangeCodexAuthorizationCode(
      "authorization-code-secret",
      "code-verifier-secret",
      { fetchLike }
    );

    expect(result.accessToken).toBe("eyJfake.codex.token.12345");
    expect(result.refreshToken).toBe("def502.fake.refresh.token.67890");
    expect(result.scopes).toEqual(["read", "write"]);
    expect(result.expiresAt).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://auth.openai.com/oauth/token");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(calls[0]?.init.body);
    expect(body.get("client_id")).toBe(CODEX_CLIENT_ID);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authorization-code-secret");
    expect(body.get("code_verifier")).toBe("code-verifier-secret");
    expect(body.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
  });

  it("throws on exchange failure without exposing sensitive response body fields", async () => {
    const { fetchLike } = createMockFetch({
      tokenExchange: () => response(
        {
          error: "invalid_grant",
          access_token: "eyJfake.codex.token.12345",
          refresh_token: "def502.fake.refresh.token.67890"
        },
        { ok: false, status: 400, statusText: "Bad Request" }
      )
    });

    let caught: unknown;
    try {
      await exchangeCodexAuthorizationCode("authorization-code-secret", "code-verifier-secret", { fetchLike });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).toContain("Token exchange failed");
      expect(caught.message).not.toContain("eyJfake.codex.token.12345");
      expect(caught.message).not.toContain("def502.fake.refresh.token.67890");
    }
  });

  it("validates access_token presence in successful response", async () => {
    const { fetchLike } = createMockFetch({
      tokenExchange: () => response({ token_type: "Bearer" })
    });

    await expect(
      exchangeCodexAuthorizationCode("authorization-code-secret", "code-verifier-secret", { fetchLike })
    ).rejects.toThrow("missing access_token");
  });
});

describe("runCodexOAuthFlow", () => {
  it("returns success with tokens after the full Codex auth flow", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret",
        interval: 0,
        expires_in: 60
      }),
      authorizationPolls: [
        () => response({}, { ok: false, status: 403, statusText: "Forbidden" }),
        () => response({
          authorization_code: "authorization-code-secret",
          code_verifier: "code-verifier-secret"
        })
      ],
      tokenExchange: () => response({
        access_token: "eyJfake.codex.token.12345",
        refresh_token: "def502.fake.refresh.token.67890",
        expires_in: 3600
      })
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
      verificationUri: "https://auth.openai.com/codex/device"
    });
  });

  it("returns cancelled when signal is aborted during polling", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret",
        interval: 1
      }),
      authorizationPolls: [
        () => response({}, { ok: false, status: 403, statusText: "Forbidden" })
      ]
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await runCodexOAuthFlow({
      fetchLike,
      signal: controller.signal
    });

    expect(result.kind).toBe("cancelled");
  });

  it("returns timeout when polling exceeds deadline", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response({
        user_code: "ABC-DEF",
        device_auth_id: "device-auth-secret",
        interval: 0,
        expires_in: 0
      }),
      authorizationPolls: [
        () => response({}, { ok: false, status: 403, statusText: "Forbidden" })
      ]
    });

    const result = await runCodexOAuthFlow({ fetchLike });

    expect(result.kind).toBe("timeout");
    if (result.kind === "timeout") {
      expect(result.reason).toContain("timed out");
    }
  });

  it("returns error on device code request failure", async () => {
    const { fetchLike } = createMockFetch({
      usercode: () => response(
        { error: "server_error" },
        { ok: false, status: 500, statusText: "Internal Server Error" }
      )
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
    const fakeAccess = "eyJfake.codex.token.12345";
    const fakeRefresh = "def502.fake.refresh.token.67890";

    expect(fakeAccess).toContain("eyJ");
    expect(fakeAccess).toContain("fake");
    expect(fakeRefresh).toContain("def502");
    expect(fakeRefresh).toContain("fake");
  });
});
