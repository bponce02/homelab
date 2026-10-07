# CLIProxyAPI — retired

CLIProxyAPI is no longer deployed. Its container and `cliproxy.develium.dev` Caddy route were removed after checking that no running container environment or saved Open WebUI configuration referenced it. LibreChat uses the independent **Codex Subscription** connector from `pi-connectors`, not CLIProxyAPI.

The Codex connector and Local Pi gateway remain running. Their keys and OAuth credentials are independent; retiring CLIProxyAPI does not log either out. No Codex provider request was submitted during retirement; health and authenticated model discovery were checked.

Private configuration and saved OAuth/log/static data under `config/env/cliproxyapi/` and `config/volumes/cliproxyapi/` are retained and gitignored. Do not delete them, publish them, revoke their credentials, or prune unrelated Docker storage as part of retirement.

The retired Compose definition, setup script and public example remain available in Git history before this retirement commit. The previous image is retained locally for recovery. Reintroduce the old configuration deliberately if needed; do not run CLIProxyAPI and the Pi connector as though they share the same OAuth store.

The pre-retirement live Caddy configuration is backed up at `/home/melissa/.local/state/librechat-fork/caddy-before-cliproxy-retirement` on Homelab. Restore only the retired route if rolling back so newer unrelated routes are preserved.
