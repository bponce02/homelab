# Personal LibreChat fork

The homelab runs `local/librechat-homelab:48f12a8f2` with `docker-compose.fork.yml` and `local/pi-codex-connector:48f12a8f2` with `pi-connectors/docker-compose.yml`. Do not use the old Pi-sync image patch overlay alongside the native fork.

```sh
cd /home/melissa/homelab/pi-connectors
sudo docker compose up -d --no-deps --no-build codex-connector
cd /home/melissa/homelab/librechat
sudo docker compose -f docker-compose.yml -f docker-compose.fork.yml up -d --no-deps --no-build librechat
```

The LibreChat source is `/home/bponce/Documents/GitHub/LibreChat`, release commit `48f12a8f2`. Native single-owner Pi sync, inbox/device push, codemode selected-tool dispatch, bounded opaque image forwarding and Codex hosted search are enabled. General selects `codemode`, `notify_user` and `codex_web_search`; its other tools and approval settings remain intact. No new approval prompts are added.

**Codex Web Search** reuses the MIT-licensed [Evizero Pi helper](https://github.com/Evizero/pi-codex-web-search) through the existing subscription connector. No Hermes installation, Codex CLI subprocess, second login or new Pi session is required. It returns a grounded answer and source links and is available through codemode. Other browser/search tools stay enabled. Generic fork configuration defaults this capability off; this deployment enables `codexSearch` with `gpt-6.1-sol` in `librechat.yaml`.

Private fork credentials remain in `config/env/librechat/fork.env` and the existing Pi connector key/OAuth files, ignored by Git. Never embed them in tool arguments or public configuration. Do not rotate VAPID keys casually: existing device subscriptions depend on them. Actual phone push display has been confirmed after explicit device opt-in.

The laptop gateway still publishes idle history. Older Pi sessions need `/reload` after their current turn to load prior notification/history bridge updates, but this server-side Codex search change itself needs no gateway restart or Pi reload.

Latest private rollback backup: `/home/melissa/.local/state/librechat-fork/rollback-codex-search-48f12a8f2/`. Wait for active jobs/requests to settle before restarting. For code-only rollback, remove only `codex_web_search` from General, remove the `codexSearch` YAML block and restore the old LibreChat overlay (`174ee2b46`). The prior connector image/release directory at `/home/melissa/homelab-releases/pi-connectors-9ecfd0b/pi-connectors` is retained. Run its saved Compose definition from its original directory (or with an explicit original path and project `pi-connectors`) so credential bind paths remain correct.

Do not automatically restore Mongo archives or delete imported chats: that discards later user data. The older backup `rollback-174ee2b46/` remains available for recovery to the pre-fork base image, which requires disabling native sync and treating imported chats as read-only without fork binding guards.

The latest production image was checked against an isolated database with no schedules, agents, devices or Pi sync. Its search tool completed real hosted search with source links. Direct/codemode browser tests, typechecks, static checks and Lighthouse passed. Both accounts were idle before rollout; the connector had no open requests before replacement. Only LibreChat and the connector were recreated. Temporary preflight containers/databases/configuration and JWT files were removed; live checks confirmed 32 existing owner conversations and the new tool in General.
