---
{
  "name": "xurl",
  "description": "Operate X/Twitter through the official xurl CLI for posts, search, timelines, DMs, media, and raw API calls.",
  "version": "1.1.1",
  "category": "social-media",
  "origin": {
    "project": "Hermes Agent",
    "organization": "Nous Research",
    "url": "https://github.com/NousResearch/hermes-agent"
  },
  "routing": {
    "labels": [
      "twitter",
      "x",
      "social-media",
      "xurl",
      "official-api"
    ],
    "triggerPatterns": [
      {
        "type": "contains",
        "value": "xurl"
      },
      {
        "type": "contains",
        "value": "twitter"
      },
      {
        "type": "contains",
        "value": "x.com"
      },
      {
        "type": "contains",
        "value": "tweet"
      },
      {
        "type": "contains",
        "value": "post on x"
      },
      {
        "type": "contains",
        "value": "post to x"
      }
    ],
    "negativePatterns": [
      {
        "type": "contains",
        "value": "blog post"
      },
      {
        "type": "contains",
        "value": "linkedin post"
      },
      {
        "type": "contains",
        "value": "http post"
      },
      {
        "type": "contains",
        "value": "post request"
      },
      {
        "type": "contains",
        "value": "post a file"
      }
    ],
    "requiredToolsets": [
      "shell-readonly",
      "shell-write"
    ],
    "confirmation": "policy",
    "priority": 40
  },
  "intentLabels": [
    "social-media"
  ],
  "triggerPatterns": [
    "xurl",
    "twitter",
    "x.com",
    "tweet",
    "post on x",
    "post to x"
  ],
  "negativePatterns": [
    "blog post",
    "linkedin post",
    "http post",
    "post request",
    "post a file"
  ],
  "whenToUse": [
    "The user explicitly wants to read, publish, reply, quote, delete, or search on X/Twitter.",
    "The user wants to use the official xurl CLI.",
    "The user wants X API v2 access through a local authenticated CLI."
  ],
  "requiredToolsets": [
    "shell-readonly",
    "shell-write"
  ],
  "optionalToolsets": [
    "files",
    "media"
  ],
  "playbook": [
    {
      "id": "check-cli-and-auth",
      "description": "Verify xurl is installed and check auth with safe commands only, without reading credential files.",
      "toolsets": [
        "shell-readonly"
      ],
      "successCriteria": [
        "xurl availability and auth state are known without exposing secrets."
      ]
    },
    {
      "id": "confirm-side-effect",
      "description": "For any post, reply, quote, delete, like, repost, DM, follow, block, mute, or media upload, restate the exact action and wait for explicit user confirmation.",
      "toolsets": [
        "shell-readonly"
      ],
      "successCriteria": [
        "The user explicitly confirms the external side effect before execution."
      ]
    },
    {
      "id": "execute-xurl-command",
      "description": "Run the minimal xurl command, never using verbose mode or inline credential flags, then summarize the JSON result.",
      "toolsets": [
        "shell-write"
      ],
      "successCriteria": [
        "The command result is reported without secrets or credential file contents."
      ]
    }
  ],
  "permissionExpectations": [
    "auto-read",
    "ask-before-write",
    "ask-before-external-send",
    "ask-before-credential-access",
    "ask-before-destructive-action"
  ],
  "examples": [
    "Search Twitter for posts about TypeScript.",
    "Post this on X after I confirm.",
    "Check my X mentions.",
    "Upload a video and tweet it."
  ],
  "evaluations": [
    {
      "input": "Post 'Hello world' on Twitter",
      "shouldUseToolsets": [
        "shell-readonly",
        "shell-write"
      ],
      "expectedOutcome": "The agent checks xurl/auth safely, asks for explicit confirmation, then runs the post command only after approval."
    }
  ]
}
---

# xurl — X API via Official CLI

xurl is the first-party command-line tool from the X developer platform. It wraps the X API v2 surface with convenient shortcuts for common tasks, while still allowing raw curl-style access to any endpoint when you need something the shortcuts don't cover. All output is JSON on stdout.

Reach for this skill whenever the user needs to:
- Publish, reply to, quote, or delete posts
- Search the public post index or read timelines and mentions
- Like, repost, bookmark, follow, block, or mute accounts
- Send direct messages
- Upload images or video
- Call any X API v2 endpoint directly
- Switch between multiple apps or accounts

This skill replaces the older `xitter` wrapper. xurl is maintained by the X platform team, supports OAuth 2.0 PKCE with automatic token refresh, and exposes a substantially larger API surface.

---

## Credential Safety (Hard Rules)

When operating inside an agent session, treat tokens like passwords:

- **Never** read, print, parse, summarize, upload, or send `~/.xurl` into the agent context.
- **Never** ask the user to paste credentials or tokens into chat.
- The user must populate `~/.xurl` manually on their own machine. In a Docker environment, this must be the `~` visible to EstaCoda tool subprocesses.
- **Never** run auth commands with inline secrets in agent sessions.
- **Never** pass `--verbose` / `-v` — it leaks auth headers.
- To verify credentials exist, use only: `xurl auth status`.

Forbidden flags that accept inline secrets:
`--bearer-token`, `--consumer-key`, `--consumer-secret`, `--access-token`, `--token-secret`, `--client-id`, `--client-secret`

App registration and credential rotation are manual, out-of-band steps. After registration, the user runs `xurl auth oauth2` outside the agent session. Tokens persist to `~/.xurl` in YAML, isolated per app. OAuth 2.0 tokens refresh automatically.

---

## Installation

Choose one method. On Linux, the shell script or `go install` are the simplest.

```bash
# Shell script (installs to ~/.local/bin, no sudo, Linux + macOS)
curl -fsSL https://raw.githubusercontent.com/xdevplatform/xurl/main/install.sh | bash

# Homebrew (macOS)
brew install --cask xdevplatform/tap/xurl

# npm
npm install -g @xdevplatform/xurl

# Go
go install github.com/xdevplatform/xurl@latest
```

Verify:

```bash
xurl --help
xurl auth status
```

If `xurl` is installed but `auth status` shows no apps or tokens, the user needs to complete auth manually — see the One-Time Setup section below.

---

## One-Time Setup (user runs outside the agent)

These steps involve pasting secrets and must be done by the user directly, not by the agent.

1. Create or open an app at https://developer.x.com/en/portal/dashboard
2. Set the redirect URI to `http://localhost:8080/callback`
3. Copy the app's Client ID and Client Secret
4. Register the app locally:
   ```bash
   xurl auth apps add my-app --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
   ```
5. Authenticate (bind the token to your app):
   ```bash
   xurl auth oauth2 --app my-app
   ```
   This opens a browser for the OAuth 2.0 PKCE flow.

   If X returns a `UsernameNotFound` error or 403 on the post-OAuth `/2/users/me` lookup, pass your handle explicitly (xurl v1.1.0+):
   ```bash
   xurl auth oauth2 --app my-app YOUR_USERNAME
   ```
   This binds the token to your handle and skips the broken `/2/users/me` call.
6. Set the app as default:
   ```bash
   xurl auth default my-app
   ```
7. Verify:
   ```bash
   xurl auth status
   xurl whoami
   ```

After this, the agent can run any command below without further setup. OAuth 2.0 tokens auto-refresh.

> **Common pitfall:** If you omit `--app my-app` from `xurl auth oauth2`, the OAuth token is saved to the built-in `default` app profile — which has no client-id or client-secret. Commands will fail with auth errors even though the OAuth flow appeared to succeed. If you hit this, re-run `xurl auth oauth2 --app my-app` and `xurl auth default my-app`.

> **Docker HOME pitfall:** In the official EstaCoda Docker layout, `/opt/data` is `ESTACODA_HOME`, but EstaCoda tool subprocesses use `/opt/data/home` as `HOME`. That means `~/.xurl` resolves to `/opt/data/home/.xurl` for EstaCoda-run `xurl` commands, not `/opt/data/.xurl`. Run the user setup with the same HOME:
> ```bash
> HOME=/opt/data/home xurl auth apps add my-app --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
> HOME=/opt/data/home xurl auth oauth2 --app my-app YOUR_USERNAME
> HOME=/opt/data/home xurl auth default my-app YOUR_USERNAME
> HOME=/opt/data/home xurl auth status
> ```
> If `HOME=/opt/data xurl auth status` succeeds but `HOME=/opt/data/home xurl auth status` shows no apps or tokens, EstaCoda tool calls will not see the credentials.

---

## Cheat Sheet

| Action | Command |
| --- | --- |
| Post | `xurl post "Hello world!"` |
| Reply | `xurl reply POST_ID "Nice post!"` |
| Quote | `xurl quote POST_ID "My take"` |
| Delete | `xurl delete POST_ID` |
| Read | `xurl read POST_ID` |
| Search | `xurl search "QUERY" -n 10` |
| Who am I | `xurl whoami` |
| Look up user | `xurl user @handle` |
| Home timeline | `xurl timeline -n 20` |
| Mentions | `xurl mentions -n 10` |
| Like / Unlike | `xurl like POST_ID` / `xurl unlike POST_ID` |
| Repost / Undo | `xurl repost POST_ID` / `xurl unrepost POST_ID` |
| Bookmark / Remove | `xurl bookmark POST_ID` / `xurl unbookmark POST_ID` |
| List bookmarks / likes | `xurl bookmarks -n 10` / `xurl likes -n 10` |
| Follow / Unfollow | `xurl follow @handle` / `xurl unfollow @handle` |
| Following / Followers | `xurl following -n 20` / `xurl followers -n 20` |
| Block / Unblock | `xurl block @handle` / `xurl unblock @handle` |
| Mute / Unmute | `xurl mute @handle` / `xurl unmute @handle` |
| Send DM | `xurl dm @handle "message"` |
| List DMs | `xurl dms -n 10` |
| Upload media | `xurl media upload path/to/file.mp4` |
| Media status | `xurl media status MEDIA_ID` |
| List apps | `xurl auth apps list` |
| Remove app | `xurl auth apps remove NAME` |
| Set default app | `xurl auth default APP_NAME [USERNAME]` |
| Per-request app | `xurl --app NAME /2/users/me` |
| Auth status | `xurl auth status` |

Notes:
- `POST_ID` accepts full URLs too (e.g. `https://x.com/user/status/1234567890`) — xurl extracts the ID.
- Usernames work with or without a leading `@`.

---

## Command Details

### Publishing

```bash
xurl post "Hello world!"
xurl post "Check this out" --media-id MEDIA_ID
xurl post "Thread pics" --media-id 111 --media-id 222

xurl reply 1234567890 "Great point!"
xurl reply https://x.com/user/status/1234567890 "Agreed!"
xurl reply 1234567890 "Look at this" --media-id MEDIA_ID

xurl quote 1234567890 "Adding my thoughts"
xurl delete 1234567890
```

### Reading & Search

```bash
xurl read 1234567890
xurl read https://x.com/user/status/1234567890

xurl search "golang"
xurl search "from:elonmusk" -n 20
xurl search "#buildinpublic lang:en" -n 15
```

For X Articles, use raw API mode instead of the `read` shortcut. `xurl read` expects a post ID or URL; do not put `read` before a `/2/tweets/...` endpoint. Request the `article` tweet field and read `data.article.plain_text` from the JSON response:

```bash
xurl --app APP_NAME '/2/tweets/2057909493250539891?expansions=author_id,attachments.media_keys,referenced_tweets.id&tweet.fields=created_at,lang,public_metrics,context_annotations,entities,possibly_sensitive,conversation_id,in_reply_to_user_id,referenced_tweets,article'
```

### Users, Timeline, Mentions

```bash
xurl whoami
xurl user elonmusk
xurl user @XDevelopers

xurl timeline -n 25
xurl mentions -n 20
```

### Engagement

```bash
xurl like 1234567890
xurl unlike 1234567890

xurl repost 1234567890
xurl unrepost 1234567890

xurl bookmark 1234567890
xurl unbookmark 1234567890

xurl bookmarks -n 20
xurl likes -n 20
```

### Social Graph

```bash
xurl follow @XDevelopers
xurl unfollow @XDevelopers

xurl following -n 50
xurl followers -n 50

# Another user's graph
xurl following --of elonmusk -n 20
xurl followers --of elonmusk -n 20

xurl block @spammer
xurl unblock @spammer
xurl mute @annoying
xurl unmute @annoying
```

### Direct Messages

```bash
xurl dm @someuser "Hey, saw your post!"
xurl dms -n 25
```

### Media Upload

```bash
# Auto-detect type
xurl media upload photo.jpg
xurl media upload video.mp4

# Explicit type/category
xurl media upload --media-type image/jpeg --category tweet_image photo.jpg

# Videos need server-side processing — check status (or poll)
xurl media status MEDIA_ID
xurl media status --wait MEDIA_ID

# Full workflow
xurl media upload meme.png                  # returns media id
xurl post "lol" --media-id MEDIA_ID
```

---

## Raw API Access

Shortcuts cover common operations. For everything else, use raw curl-style mode against any X API v2 endpoint:

```bash
# GET
xurl /2/users/me

# POST with JSON body
xurl -X POST /2/tweets -d '{"text":"Hello world!"}'

# DELETE / PUT / PATCH
xurl -X DELETE /2/tweets/1234567890

# Custom headers
xurl -H "Content-Type: application/json" /2/some/endpoint

# Force streaming
xurl -s /2/tweets/search/stream

# Full URLs also work
xurl https://api.x.com/2/users/me
```

---

## Global Flags

| Flag | Short | Description |
| --- | --- | --- |
| `--app` | | Use a specific registered app (overrides default) |
| `--auth` | | Force auth type: `oauth1`, `oauth2`, or `app` |
| `--username` | `-u` | Which OAuth2 account to use (if multiple exist) |
| `--verbose` | `-v` | **Forbidden in agent sessions** — leaks auth headers |
| `--trace` | `-t` | Add `X-B3-Flags: 1` trace header |

---

## Streaming

Streaming endpoints are auto-detected. Known ones include:

- `/2/tweets/search/stream`
- `/2/tweets/sample/stream`
- `/2/tweets/sample10/stream`

Force streaming on any endpoint with `-s`.

---

## Output Format

All commands return JSON to stdout. Structure mirrors X API v2:

```json
{ "data": { "id": "1234567890", "text": "Hello world!" } }
```

Errors are also JSON:

```json
{ "errors": [ { "message": "Not authorized", "code": 403 } ] }
```

---

## Workflows

### Post with an image
```bash
xurl media upload photo.jpg
xurl post "Check out this photo!" --media-id MEDIA_ID
```

### Reply to a conversation
```bash
xurl read https://x.com/user/status/1234567890
xurl reply 1234567890 "Here are my thoughts..."
```

### Search and engage
```bash
xurl search "topic of interest" -n 10
xurl like POST_ID_FROM_RESULTS
xurl reply POST_ID_FROM_RESULTS "Great point!"
```

### Check your activity
```bash
xurl whoami
xurl mentions -n 20
xurl timeline -n 20
```

### Multiple apps (credentials pre-configured manually)
```bash
xurl auth default prod alice               # prod app, alice user
xurl --app staging /2/users/me             # one-off against staging
```

---

## Error Handling

- Non-zero exit code on any error.
- API errors are still printed as JSON to stdout, so you can parse them.
- Auth errors → have the user re-run `xurl auth oauth2` outside the agent session.
- Commands that need the caller's user ID (like, repost, bookmark, follow, etc.) will auto-fetch it via `/2/users/me`. An auth failure there surfaces as an auth error.

---

## Agent Workflow

1. Verify prerequisites: `xurl --help` and `xurl auth status`.
2. **Check the default app has credentials.** Parse the `auth status` output. The default app is marked with `▸`. If the default app shows `oauth2: (none)` but another app has a valid oauth2 user, tell the user to run `xurl auth default <that-app>` to fix it. This is the most common setup mistake — the user added an app with a custom name but never set it as default, so xurl keeps trying the empty `default` profile.
3. If auth is missing entirely, stop and direct the user to the "One-Time Setup" section — do NOT attempt to register apps or pass secrets yourself.
4. Start with a cheap read (`xurl whoami`, `xurl user @handle`, `xurl search ... -n 3`) to confirm reachability.
5. Confirm the target post/user and the user's intent before any write action (post, reply, like, repost, DM, follow, block, delete).
6. Use JSON output directly — every response is already structured.
7. Never paste `~/.xurl` contents back into the conversation.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Auth errors after successful OAuth flow | Token saved to `default` app (no client-id/secret) instead of your named app | `xurl auth oauth2 --app my-app` then `xurl auth default my-app` |
| `unauthorized_client` during OAuth | App type set to "Native App" in X dashboard | Change to "Web app, automated app or bot" in User Authentication Settings |
| `UsernameNotFound` or 403 on `/2/users/me` right after OAuth | X not returning username reliably from `/2/users/me` | Re-run `xurl auth oauth2 --app my-app YOUR_USERNAME` (xurl v1.1.0+) to pass the handle explicitly |
| 401 on every request | Token expired or wrong default app | Check `xurl auth status` — verify `▸` points to an app with oauth2 tokens |
| `client-forbidden` / `client-not-enrolled` | X platform enrollment issue | Dashboard → Apps → Manage → Move to "Pay-per-use" package → Production environment |
| `CreditsDepleted` | $0 balance on X API | Buy credits (min $5) in Developer Console → Billing |
| `media processing failed` on image upload | Default category is `amplify_video` | Add `--category tweet_image --media-type image/png` |
| Two "Client Secret" values in X dashboard | UI bug — first is actually Client ID | Confirm on the "Keys and tokens" page; ID ends in `MTpjaQ` |

---

## Notes

- **Rate limits:** X enforces per-endpoint rate limits. A 429 means wait and retry. Write endpoints (post, reply, like, repost) have tighter limits than reads.
- **Scopes:** OAuth 2.0 tokens use broad scopes. A 403 on a specific action usually means the token is missing a scope — have the user re-run `xurl auth oauth2`.
- **Token refresh:** OAuth 2.0 tokens auto-refresh. Nothing to do.
- **Multiple apps:** Each app has isolated credentials/tokens. Switch with `xurl auth default` or `--app`.
- **Multiple accounts per app:** Select with `-u / --username`, or set a default with `xurl auth default APP USER`.
- **Token storage:** `~/.xurl` is YAML. In Docker, use the EstaCoda subprocess HOME (`/opt/data/home` in the official image) so tokens land under `/opt/data/home/.xurl`. Never read or send this file to LLM context.
- **Cost:** X API access is typically paid for meaningful usage. Many failures are plan/permission problems, not code problems.

---

## Attribution

- Upstream CLI: https://github.com/xdevplatform/xurl (X developer platform team, Chris Park et al.)
- Upstream agent skill: https://github.com/openclaw/openclaw/blob/main/skills/xurl/SKILL.md
- EstaCoda adaptation: routing frontmatter and branding alignment for the EstaCoda runtime.
