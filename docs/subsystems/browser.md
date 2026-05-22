---
title: "Browser Automation"
description: "Browser backend, CDP integration, and structured browser tools."
---

# Browser Automation

## Files

| File | Lines | Role |
|------|-------|------|
| `src/browser/browser-backend.ts` | 766 | Backend abstraction with mock and CDP |
| `src/tools/web-tools.ts` | 731 | Browser tool schemas and execution |

## Backends

| Backend | Status | Evidence |
|---------|--------|----------|
| Local Chrome CDP | Implemented | `smoke-tested` |
| Mock | Implemented | `smoke-tested` |
| Browserbase | Recognized in config | `intended but not implemented` |
| Browser Use | Recognized in config | `intended but not implemented` |
| Firecrawl | Recognized in config | `intended but not implemented` |
| Camofox | Recognized in config | `intended but not implemented` |

## CDP Capabilities

| Capability | Status |
|------------|--------|
| Navigation | `smoke-tested` |
| Snapshot with `@eN` element refs | `smoke-tested` |
| Click | `smoke-tested` |
| Type | `smoke-tested` |
| Scroll | `smoke-tested` |
| Press key | `smoke-tested` |
| Back | `smoke-tested` |
| Image listing | `smoke-tested` |
| Page-local console capture | `smoke-tested` |
| Raw CDP passthrough | `smoke-tested` |
| Screenshot | `smoke-tested` |
| Screenshot vision analysis | `smoke-tested` |
| JavaScript dialog response | `smoke-tested` |

## Tools

Browser tools exposed to the agent:

| Tool | Description |
|------|-------------|
| `browser.status` | Show browser state |
| `browser.navigate` | Navigate to URL |
| `browser.snapshot` | Get accessible page snapshot |
| `browser.click` | Click element by ref |
| `browser.type` | Type text into element |
| `browser.scroll` | Scroll page |
| `browser.press` | Press keyboard key |
| `browser.back` | Navigate back |
| `browser.get_images` | List page images |
| `browser.console` | Get console output |
| `browser.cdp` | Raw CDP command |
| `browser.screenshot` | Capture screenshot |
| `browser.vision` | Analyze screenshot with vision |
| `browser.dialog` | Respond to JS dialog |

## URL Safety And Website Policy

Browser and web tools share the URL-safety foundation in `src/browser/url-safety.ts` and website blocklist policy in `src/browser/website-policy.ts`.

Default behavior:

- `web.extract`, `browser.navigate`, and URL-capable `browser.cdp` methods block private, internal, loopback, link-local, multicast, unspecified, reserved, and CGNAT targets by default.
- Cloud metadata endpoints are always blocked, including `metadata.google.internal`, `metadata.goog`, `169.254.169.254`, `169.254.170.2`, `169.254.169.253`, `fd00:ec2::254`, `100.100.100.200`, and IPv4-mapped forms.
- `security.allowPrivateUrls: true` allows ordinary private URLs but does not bypass the metadata block floor.
- Secret-bearing URLs are rejected and redacted before being returned in tool metadata.

Current coverage:

- `web.extract` checks the initial URL before fetch.
- `web.extract` uses manual redirects and checks each redirect target before reading the response body.
- `browser.navigate` checks the initial URL before backend availability and navigation.
- `browser.navigate` checks the final post-navigation URL and best-effort navigates the same session to `about:blank` when the final URL violates the safety floor or website policy.
- `browser.cdp` is classified as `external-side-effect`; URL-capable methods such as `Page.navigate`, `Target.createTarget`, `Runtime.evaluate`, and `Runtime.callFunctionOn` are guarded for explicit URLs and obvious network/navigation literal URL usage.

## Configuration

```bash
pnpm run dev -- browser setup --backend local-cdp --cdp-url http://127.0.0.1:9222
pnpm run dev -- browser test
```

`security.allowPrivateUrls` is the canonical setting for private URL access:

```json
{
  "security": {
    "allowPrivateUrls": false,
    "websiteBlocklist": {
      "domains": ["example.com", "*.blocked.example"],
      "sharedFiles": ["/path/to/blocklist.txt"]
    }
  }
}
```

`browser.allowPrivateUrls` remains a deprecated alias only. `ESTACODA_ALLOW_PRIVATE_URLS` overrides config; accepted true values are `1`, `true`, `yes`, and `on`, and accepted false values are `0`, `false`, `no`, and `off`. Invalid values fail runtime config loading.

Website blocklist rules are normalized to lowercase hosts, strip a trailing dot, and strip a leading `www.`. Rules can be exact domains such as `example.com` or wildcard suffixes such as `*.example.com`. Shared files use one rule per line; blank lines and `#` comments are ignored, and missing shared files warn and are skipped.

## Limitations

- Cloud backends are not implemented.
- Persistent dialog supervisor is missing.
- Browser can be selected as an optional reviewed setup capability, but setup records configuration intent and does not auto-launch the browser runtime.
- Socket-level DNS rebinding and TOCTOU protection is not implemented.
- Browser subresource interception is not implemented yet; PR 2C is expected to cover it.
- `Runtime.evaluate` and `Runtime.callFunctionOn` guards detect obvious literal URL usage but do not perform full JavaScript static analysis.
