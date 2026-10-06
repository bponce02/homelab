# Pi connectors for LibreChat

**Codex Subscription is authenticated, enabled in LibreChat, and verified end-to-end. Local Pi is not activated.** This single-user LibreChat instance now supplies the connector key server-side; no per-user key entry is needed. New account registration is disabled. CLIProxyAPI and local Pi sessions remain unchanged.

Two independent processes share a small authenticated OpenAI-compatible HTTP layer:

- **Codex Subscription** imports pinned `@earendil-works/pi-ai@1.0.4` for subscription OAuth, refresh, model discovery, and inference. LibreChat owns its conversation, tools, memory, and schedules. No CLIProxyAPI dependency, account pool, management dashboard, or Pi agent runs here.
- **Local Pi** runs on the laptop beside Herdr. A small extension exposes each opted-in Pi session over a private Unix socket. The HTTP gateway verifies Herdr's pane/session identity and exposes only explicitly allowlisted sessions as models. Pi owns its existing history, tools, instructions, and active branch. No terminal scraping, second agent, MongoDB edits, or history synchronization.

`GET /health` is unauthenticated liveness only. `GET /v1/models` and `POST /v1/chat/completions` require `Authorization: Bearer <client key>`. Both JSON and SSE responses work. These are **single-owner connectors**, not multi-tenant services. A Local Pi key grants the ability to request actions with the local Pi process's OS permissions.

## Local checks

Node 24+ and npm are required; Pi 1.0.4 is the tested extension API. Herdr's installed CLI is authoritative for its socket protocol.

```bash
cd pi-connectors
npm ci --ignore-scripts
npm run check
npm test
docker compose config --quiet
```

Tests use Pi's fake provider, an isolated real SDK session, temporary Unix sockets, and temporary credentials. They do not log in, contact Codex, submit work to an existing session, or deploy containers. Coverage includes HTTP authentication, tool translation, Unicode streaming, busy/offline/identity checks, request deduplication, disconnection, and cross-process credential locking.

**Verified on the homelab:** Docker image build, non-root/read-only runtime, health, client-key enforcement, model discovery, owner OAuth, real `gpt-5.5` inference/SSE, and a synthetic function-call/result round-trip from the actual LibreChat container. A browser test also verified a completed Codex reply through LibreChat, on desktop/mobile in light/dark modes. Temporary verification accounts and their saved keys were deleted through LibreChat's API afterward. No host ports are published.

**Still requires validation:** Local Pi activation/reachability from the actual LibreChat container to the laptop, and real LibreChat agent/MCP/schedule scenarios. No LibreChat frontend modifications were made.

## Current deployment

The homelab's existing checkout contains live modifications and service data, so it was not pulled, reset, or overwritten. Only the connector was deployed from committed source:

- Releases are named by their source commit, with `pi-connectors-current` pointing to the verified active release.
- Active release: `/home/melissa/homelab-releases/pi-connectors-current/pi-connectors`.
- The release's parent `config` symlink points to `/home/melissa/homelab/config`; credentials/state survive release changes.
- Compose project: `pi-connectors`; container: `pi-connectors-codex-connector-1`.
- The original `cd037ce` release failed its non-root file-permission check and was replaced. The Dockerfile now sets readable package permissions and source ownership explicitly, including for privately extracted build contexts.
- Only the connector and LibreChat were restarted. The Codex endpoint and agent-provider allowance are applied; Local Pi remains an example only. Live LibreChat MCP settings were preserved rather than replaced with pending repo changes.
- The pre-Codex LibreChat configuration backup is `/home/melissa/homelab-releases/config-backups/librechat-before-codex-20261006T061803Z.yaml` (owner-readable only).

Owner login from a terminal with the existing SSH alias:

```bash
ssh -t Homelab 'cd /home/melissa/homelab-releases/pi-connectors-current/pi-connectors && docker compose run --rm -it codex-connector npm run login'
```

At the login-method menu, choose **2: Device code login (headless)** for the SSH/container workflow. Open the printed verification URL and enter the displayed code yourself; no localhost callback or pasted redirect is needed. If device-code login is unavailable, choose **1: Browser login** instead and paste any callback URL into that terminal only, never into chat. The running connector reads the resulting credential store; it does not need a restart after login.

## Codex Subscription: deployment procedure

On the homelab, from this directory:

```bash
npm ci --ignore-scripts
npm run setup -- codex
docker compose build
docker compose run --rm -it codex-connector npm run login
docker compose up -d
```

`setup` creates a random client key without overwriting an existing key:

- `config/env/pi-connectors/codex.key`: LibreChat client key, mode 0600.
- `config/volumes/pi-connectors/codex/auth.json`: independent OAuth credentials, mode 0600, created by login.

Directories are mode 0700. Both paths are gitignored. Compose runs as UID/GID 1000; ensure the setup user/volume ownership matches before deployment. OAuth writes and refreshes are serialized across processes and atomically replaced. Credentials are never imported from Pi or CLIProxyAPI. Back up the state securely; never publish it or attach it to an issue.

The CLI displays the provider's login-method choices. Device-code login is recommended remotely: open the verification URL and enter its short-lived code yourself. Browser login is also supported; in a remote/container login, the browser's localhost callback may fail: copy the **entire redirect URL** from the address bar into the CLI's manual callback prompt. Keep that URL private. Do not publish the callback port or put a bearer/OAuth token in a URL.

The server is available internally at `http://codex-connector:8788/v1` on Docker's `proxy` network. No host port or Caddy route is added. `/health` does not prove OAuth validity or subscription/model entitlement. Discovery returns Pi's pinned catalog, not a guarantee your account can use every model.

Supported: text/system/developer history, inline base64 images, function definitions/calls/results, reasoning summaries, usage, JSON/SSE, and upstream cancellation. The adapter never executes tools. Remote image URLs are rejected rather than fetched. Structured response formats, legacy function APIs, logprobs, stop sequences, named forced tool calls, and unsupported sampling options are rejected. `tool_choice` supports auto/none/required. Pi/Codex controls model-specific reasoning and token limits; `max_tokens` is not a guaranteed hard budget on the subscription transport. The LibreChat example drops sampling/budget knobs rather than implying such guarantees.

## Local Pi: future activation

This runs **on the local machine**, not in the homelab Docker stack. The laptop must remain awake, connected to Tailscale, and running the selected Herdr/Pi sessions.

### 1. Opt sessions into the extension

After approval, append this absolute path to the existing `extensions` array in `~/.pi/agent/settings.json`, preserving other settings:

```text
/home/YOUR_USER/Documents/GitHub/homelab/pi-connectors/extension/index.ts
```

Run `/reload` manually in the Herdr Pi sessions you want to expose. For a new Pi process, the same path can be supplied with `pi --extension /absolute/path/to/extension/index.ts`. Do not copy `index.ts` alone: it imports the adjacent connector source.

The extension activates only when the session already has `HERDR_ENV=1`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH`. It creates private registrations under `~/.local/state/pi-gateway/run/`. No other pane is selected or controlled. It does not submit anything merely by loading.

### 2. Allowlist stable session IDs and create a client key

From this directory:

```bash
PI_CONNECTOR_STATE="$HOME/.local/state/pi-gateway" npm run setup
cp -n sessions.example.json sessions.json
```

Edit `sessions.json`. Use the Pi **session UUID**, not the Herdr pane ID, as `sessionId`. Registration filenames in `~/.local/state/pi-gateway/run/` contain the UUID; their JSON records contain the matching Herdr pane and session file. `herdr agent get "$HERDR_PANE_ID"` can confirm the current pane's session file. For example:

```json
{"sessions":[{"id":"homelab","name":"Homelab Pi","sessionId":"ACTUAL-PI-SESSION-UUID"}]}
```

The client model is `pi/homelab`. The config is re-read for discovery and each request. Offline/unregistered/mismatched sessions are omitted from discovery. Busy sessions remain discoverable but refuse work with HTTP 409. Multiple LibreChat chats targeting the same model share the **same Pi context**; starting a new LibreChat chat does not reset Pi.

### 3. Start the gateway on loopback or the laptop's Tailscale IPv4

```bash
PI_CONNECTOR_MODE=sessions \
PI_CONNECTOR_STATE="$HOME/.local/state/pi-gateway" \
PI_CONNECTOR_HOST="$(tailscale ip -4)" \
HERDR_BIN="$HOME/.local/bin/herdr" \
npm start
```

Default binding is `127.0.0.1:8787`; a non-loopback session gateway must bind to a Tailscale IPv4 address. Do not bind all interfaces, add public DNS/Caddy routes, or expose the Herdr/extension sockets. Restrict the laptop's Tailscale ACL/firewall to the homelab source that actually reaches it; Docker egress may use the homelab host's identity rather than Caddy's sidecar. Verify from the **LibreChat container**, not just SSH. HTTP here is transported over the encrypted tailnet; the gateway itself does not terminate TLS.

Optional user-service template: `pi-session-gateway.service.example`. Review its checkout path and Node/PATH settings before copying/enabling it. Its optional `~/.config/pi-gateway.env` can contain `PI_CONNECTOR_HOST=<actual Tailscale IPv4>`. Do not enable it until interactive tests pass. Only one gateway may own a state directory; a file lock enforces this.

Environment overrides: `PI_CONNECTOR_PORT`, `PI_CONNECTOR_KEY_FILE`, `PI_SESSIONS_CONFIG`, and `PI_SESSION_BRIDGE_DIR`. If overriding the bridge directory, use the same value in Pi's launch environment and the gateway. Keep the directory path short enough for Unix socket limits.

### Request behavior and recovery

- Only the final **text-only user message** is forwarded. System prompts and earlier LibreChat messages are deliberately ignored: Pi already owns the context. Attachments, CLI `/commands` and `!shell` input, and LibreChat tool loops are rejected.
- The extension reserves an idle session before submission. It waits for **`agent_settled`**, not merely `agent_end`; Pi's tools, retries, and automatic continuations remain Pi's responsibility. Text is streamed, not terminal escape codes or tool UI. Local approvals still happen in Pi/Herdr, not LibreChat.
- Ordinary local prompt input is held in the editor while remote work is active. Interrupt locally with Pi's normal controls before starting different work. Avoid simultaneous automation from other extensions.
- **LibreChat Stop/disconnect does not abort the local Pi agent.** The gateway detaches; Pi can finish safely. A ten-minute HTTP deadline also detaches. Use the local terminal to stop the agent. This intentionally differs from Codex-only inference, where disconnect cancels the provider call.
- A private SQLite journal stores request fingerprints and completed replies. `Idempotency-Key` is supported; otherwise the session UUID plus submitted message history defines a retry. Identical completed requests replay the cached response. Reusing an explicit key for different input returns 409. To intentionally repeat identical work, change the prompt/history or supply a fresh key.
- Pending/interrupted requests are **not automatically resubmitted**. Gateway restarts mark unfinished requests indeterminate; Pi also records submission IDs as non-context custom session entries. This is conservative at-most-once submission protection, not an exactly-once tool-execution guarantee. Inspect Pi before issuing replacement work. A lost connection may mean the answer exists only in Pi.
- Replies/journal entries are retained locally and may contain private data. Protect/back up `~/.local/state/pi-gateway`; do not clear its journal to make a request retry. Pi session files remain authoritative.
- If another extension consumes/rejects the submitted input before a run starts, the bridge may stay reserved. Inspect Pi and manually `/reload` when safe; do not blindly retry potentially side-effecting work.
- A crash can leave a stale `<UUID>.sock`/`<UUID>.json`. The extension fails closed rather than stealing an existing registration. Confirm the old process is gone and that `curl --unix-socket /path/to/<UUID>.sock http://localhost/status` cannot reach it before removing **those two registration files only**, then `/reload`. Never remove an active socket, Pi history, or the request journal. Opening the same session twice is intentionally not supported by the bridge.

## LibreChat configuration

Codex Subscription is present in the repo and live `endpoints.custom` configuration. Refresh https://librechat.develium.dev and select **Codex Subscription**—no API-key entry is needed.

LibreChat receives `CODEX_CONNECTOR_API_KEY` from private, gitignored `config/env/pi-connectors/librechat.env` (mode 0600), populated from `codex.key`. Neither key value nor OAuth credentials belong in YAML or chat. Recreate only the LibreChat container after changing this env file; a restart alone does not reload Docker's environment.

The dropdown is pinned to the newest available variant of each GPT-6 family model: `gpt-6.1-sol`, `gpt-6-astra`, and `gpt-6-luna`. All three passed live subscription requests. `models.fetch: false` prevents the provider's older catalog entries from reappearing; update this allowlist deliberately when new supported models arrive.

`ALLOW_REGISTRATION=false` keeps new sign-ups disabled. A server-configured key is available to every existing account allowed to use that endpoint. Revisit this choice before turning the instance into a multi-user service.

The **Local Pi** entry in [`../librechat/pi-endpoints.example.yaml`](../librechat/pi-endpoints.example.yaml) is still opt-in. Append only that entry when its gateway is ready; do not duplicate Codex or replace Ollama, OpenRouter, MCP, memory, or schedules.

Add `LOCAL_PI_BASE_URL=http://<laptop-tailscale-ip>:8787/v1` to the existing private `config/env/librechat/.env` before an approved LibreChat restart. Never use `localhost` for the laptop endpoint inside the homelab container.

The inactive Local Pi example still uses `apiKey: user_provided`. Its first model fetch may fall back to example defaults until a key is saved; align the fallback model with the session allowlist. Decide its owner-only authentication configuration when activating the gateway. Protect LibreChat's encryption keys/database and the private server env files.

**Codex Subscription** is already included in `endpoints.agents.allowedProviders`; **Local Pi** must not be added. Keep Local Pi in ordinary chat mode with LibreChat tools/agents disabled. Keep `titleConvo: false`; automatic title/summary/background generation must not send extra prompts into a real Pi session. Do not schedule Local Pi chats in this initial integration. No frontend fork is required.

Next, activate and verify Local Pi discovery, busy rejection, one harmless forwarded prompt, streaming, and disconnect behavior. Existing CLIProxyAPI remains untouched until explicitly retired.
