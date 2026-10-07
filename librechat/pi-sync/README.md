# Pi session → LibreChat Projects sync

Opt-in integration for the standalone, single-process LibreChat **v0.8.8** deployment. The existing OpenAI-compatible gateway remains the prompt/reply transport. This adds project-grouped history and automatic session selection; it does not create another AI agent.

## Implementation

- `pi-connectors/extension/index.ts` exposes `/history` on its private Unix socket, only while Pi is idle. It uses `getBranch()` and `getLeafId()`, not the last line of a session file. Only user/assistant text is exported. Reasoning, system prompts, tool arguments/results, attachments, and other branches are excluded. Assistant steps are combined into one reply per user turn; non-text-only user turns get a placeholder.
- `pi-connectors/src/librechat-sync.ts` polls registered sessions every 10 seconds and pushes changed snapshots to `/api/pi-sync`. No database connection or LibreChat login token exists on the laptop. Failed pushes are retried; successful fingerprints are cached in memory, so restart safely replays snapshots.
- `service.cjs` creates one project per full working directory and one conversation per Pi session, using deterministic conversation/message IDs. Display titles use Pi's session name, then the first user message. Projects use the working-directory basename, including worktree names.
- `index.cjs` runs **inside LibreChat**, using its model methods for conversation/message/project writes. A separate `PiSyncLink` collection stores owner-scoped bindings and acknowledged history fingerprints. Chats are saved with `endpoint: "Local Pi"` and `model: "pi/session-<session UUID>"`; the gateway resolves this stable identifier even if the directory/display name changes.
- `patch.cjs` installs the route and guards into the pinned upstream image. It also attaches LibreChat's actual preallocated user/assistant message IDs to the Local Pi request as a server-generated `X-Pi-Turn` header. The extension persists these IDs in a non-context custom entry. Sync reuses the existing streamed messages rather than copying them again.
- Guards reject changing a bound chat's endpoint/model, stale parent messages, regeneration/continuation, and message editing/deletion. The extension checks the exact expected Pi leaf immediately before accepting a prompt. A changed context is an error, never an implicit redirect.

No frontend fork or CSS changes are required. Existing Projects UI and conversation loading select the saved endpoint/model automatically. **Refresh/reopen the chat to see terminal-origin updates**; live browser cache invalidation is not implemented yet.

## Scope and safety

This is opt-in because it copies existing session text into LibreChat's database, where normal account access, backups, and configured sharing apply. Visible text can contain secrets even though tool payloads and reasoning are excluded. The configured sync credential represents **one explicitly selected owner**; the request cannot choose an owner. Protect it like an account credential. Do not reuse the gateway API key.

Use HTTPS and never log the credential or snapshot contents. Redirects are refused. The endpoint rejects browser Origin headers and invalid credentials; the normal LibreChat JWT remains necessary to read chats or send messages. Existing non-synced chats continue using the normal gateway.

This implementation is for one LibreChat process, not a replicated or tenant-isolated deployment. Maximum snapshot size is 2 MiB, 2,000 text messages, and 256 Ki characters per message. Oversized snapshots fail rather than silently dropping history. Busy/offline/old bridge registrations are retried later. Already imported offline chats remain readable; sending fails closed when the session is unavailable.

Pi stays authoritative. A history prefix change (branch navigation, a replaced earlier entry, or a shorter branch) refuses synchronization instead of deleting/rearranging LibreChat messages. Fork a new Pi session for another branch. Deleting a linked LibreChat chat disables its binding once a subsequent snapshot arrives; it is not silently recreated. An interrupted LibreChat reply with unfinished/error state requires inspection rather than an automatic rewrite. Retry of a possibly submitted prompt remains conservative.

Message timestamps currently reflect LibreChat import time (its `saveMessage` method owns timestamps). Titles are set at creation; later renames in LibreChat are preserved. Existing independent LibreChat chats are not merged into canonical synced chats. The first import creates a separate, project-grouped chat.

## Enable on the homelab

**Not enabled by the default compose file.** Build/test the optional overlay before changing the live service. Back up the LibreChat database and retain the existing base image/config for rollback. Restarting LibreChat disconnects active browser requests, so wait for them to finish.

1. Create `config/env/librechat/pi-sync.env`, mode `0600`:

   ```dotenv
   PI_SYNC_OWNER_ID=<existing owner's Mongo user ID>
   PI_SYNC_KEY=<new random credential, at least 32 characters>
   ```

   Resolve the owner through LibreChat's authenticated user API or administration tools; never guess from the first database row.

2. Build and start with both compose files, from `librechat/`:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.pi-sync.yml build librechat
   docker compose -f docker-compose.yml -f docker-compose.pi-sync.yml up -d --no-deps librechat
   ```

   The patcher fails the image build if the pinned source anchors change. Do not silently apply it to another LibreChat release. Preserve all current env files and mounts; the overlay adds only the image/build and the owner/key env file.

3. On the laptop, save the **same** `PI_SYNC_KEY` as a raw string in `~/.local/state/pi-gateway/librechat-sync.key` (mode `0600`). Add to `~/.config/pi-gateway.env`:

   ```dotenv
   PI_LIBRECHAT_SYNC_URL=https://librechat.develium.dev/api/pi-sync
   PI_LIBRECHAT_SYNC_KEY_FILE=/home/bponce/.local/state/pi-gateway/librechat-sync.key
   ```

4. Run `/reload` in the Herdr Pi sessions to activate the new history endpoint and turn correlation. New processes load the globally configured bridge automatically. Restart `pi-session-gateway.service` only when no remote request is pending. Do not interrupt a live session to force registration.
5. Wait for an idle snapshot, then refresh LibreChat. Open **Projects → repository/worktree → session title**. No model selection is needed. Refresh again after a terminal-origin turn finishes. The first 10-second interval after a reply reconciles its IDs before another message can be sent from that chat.

Rollback: unset `PI_LIBRECHAT_SYNC_URL`, restart the idle gateway, and recreate LibreChat with only `docker-compose.yml`. Imported projects/chats remain in the database; no data rollback or deletion is automatic. **Bound-chat write protections exist only in the patched image**; treat imported chats as read-only after rolling it back.

## Verification

```sh
cd pi-connectors && npm run check && npm test
node --test ../librechat/pi-sync/service.test.cjs
```

Tests cover real SDK/Unix bridge history, active leaf identity, text filtering, turn correlation, retry acknowledgment, owner separation, project/chat creation, deterministic replay, partial-write recovery, model binding, stale parents, and deletion/branch fail-closed behavior.

An isolated Docker deployment (new temporary Mongo database and synthetic test account, no live user data) was also verified:

- authenticated snapshot POST, unauthenticated rejection, repeat import without duplicates;
- real LibreChat Projects membership and automatic model selection;
- browser reply through a synthetic OpenAI-compatible backend, with the actual saved user/assistant IDs in the forwarded turn header;
- post-reply reconciliation keeping exactly four messages;
- owner-authenticated edits/deletions of synced messages rejected;
- desktop/mobile screenshots in light/dark mode.

This browser check uses a fake inference backend; the real Pi SDK bridge is exercised separately by automated tests. Production end-to-end activation remains a rollout step, not something the isolated test proves.
