---
title: Browser
description: Local CDP browser automation, URL safety, and operational boundaries.
sidebar_position: 11
---

# Browser

EstaCoda automates browsers through the Chrome DevTools Protocol (CDP). The only live backend in v0.1.0 is local CDP. Cloud browser providers are registered but not implemented. The browser is not magic. It is a supervised tool with explicit safety boundaries.

---

## What Is Implemented

| Backend | Status | Notes |
|---|---|---|
| **local-cdp** | `live-proven` | Connects to a local Chrome/Chromium instance over CDP. |
| **mock** | `implemented` | Test backend for smoke tests. No real browser. |
| **Browserbase** | `unsupported` | Registered stub. Not implemented. |
| **browser-use** | `unsupported` | Registered stub. Not implemented. |
| **Firecrawl (browser)** | `unsupported` | Registered stub. Not implemented. |
| **Camofox** | `unsupported` | Registered stub. Not implemented. |

Legacy config values `browserbase`, `firecrawl`, and `camofox` for `browser.backend` remain accepted for compatibility but report `recognized-but-not-implemented` status. They do not create real sessions.

---

## Local CDP Operations

When local CDP is configured and connected, the following operations are supported:

- `status` — check browser connection state
- `navigate` — load a URL
- `snapshot` — capture accessible DOM snapshot
- `click` — click an element by ref
- `type` — type text into an input
- `scroll` — scroll the page
- `key press` — send a keyboard key
- `back` — navigate back
- `image listing` — list images on the page
- `console capture` — read browser console output
- `raw CDP method call` — execute arbitrary CDP method
- `screenshot` — capture page screenshot
- `dialog handling` — accept/dismiss dialogs

All operations except `status` require an active CDP session. The session is created when the browser backend is initialized.

---

## URL Safety

Browser navigation enforces URL safety rules. The system does not trust URLs implicitly.

### Allowed Protocols

Only `http:` and `https:` are permitted. Other protocols are rejected before navigation.

### Blocked by Default

Private and internal URLs are blocked unless `browser.allowPrivateUrls` is explicitly enabled:

- `localhost`
- `127.0.0.1`
- `*.local`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`

### Always Blocked

Cloud metadata endpoints are always blocked, regardless of `allowPrivateUrls`:

- `metadata.google.internal`
- `metadata.goog`
- `169.254.169.254`
- `169.254.170.2`
- `169.254.169.253`
- `fd00:ec2::254`
- `100.100.100.200`

### Secret Detection

URLs containing secret-like markers (API keys, tokens, passwords) are redacted or blocked by guarded tool paths.

### Website Blocklists

Blocklists support exact domains, wildcard domains, and shared files. The blocklist is checked before navigation.

---

## Approval Gating

`browser.cdp` is approval-gated by default. The raw CDP method call can execute arbitrary browser commands, so it requires explicit approval unless the security mode is `open` and the command passes the hardline floor.

Standard browser operations (`navigate`, `click`, `type`, `scroll`) follow the normal tool approval policy. They are not gated as heavily as raw CDP.

---

## Configuration

Browser configuration lives under `browser` in profile config:

```json
{
  "browser": {
    "backend": "local-cdp",
    "cdpUrl": "http://localhost:9222",
    "autoLaunch": false,
    "allowPrivateUrls": false,
    "headless": false,
    "blocklist": ["example-bad-domain.com"]
  }
}
```

| Key | Default | Description |
|---|---|---|
| `backend` | `unconfigured` | Browser backend to use. |
| `cdpUrl` | `http://localhost:9222` | CDP endpoint for local Chrome. |
| `autoLaunch` | `false` | Whether to auto-launch Chrome if not running. |
| `allowPrivateUrls` | `false` | Whether to allow private/internal URLs. |
| `headless` | `false` | Whether to run Chrome headless. |
| `blocklist` | `[]` | Additional domains to block. |

If `autoLaunch` is true and Chrome is not running, EstaCoda attempts to launch a supervised Chrome instance with security flags. If the launch fails, the operation reports the error and does not retry automatically.

---

## State and Files

Browser state is profile-local:

- CDP session state lives in memory during the runtime lifetime
- Screenshots and artifacts are written to the active profile's temp directory
- Browser console logs are captured per session and included in artifact recording

There is no persistent browser profile or cookie jar across sessions unless Chrome is launched with a persistent user data directory.

---

## Failure Modes

**CDP connection refused:** Chrome is not running on the configured `cdpUrl`. Start Chrome with `--remote-debugging-port=9222` or enable `autoLaunch`.

**Navigation blocked:** The URL violated safety rules. Check the blocklist, private URL policy, or metadata endpoint list.

**Raw CDP approval required:** The command needs approval. Approve it, or change the security mode if the hardline floor permits.

**Screenshot fails:** The page may not have finished loading. The snapshot tool captures the DOM; screenshots capture the rendered surface. Timing matters.

**Auto-launch fails:** Chrome binary not found, or insufficient permissions to launch. Check `which google-chrome` or `which chromium-browser`.

---

## Related

- [Tools](./tools.md) — tool overview
- [Security and Approvals](./security-and-approvals.md) — approval behavior
- [Provider Reference](../reference/provider-reference.md) — provider maturity matrix
