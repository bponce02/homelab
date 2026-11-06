# Service and data inventory

Source: this repository at commit `5defd84` plus its service READMEs. **The live homelab has not been audited.** Several services are documented as running differently from their Compose files (see [Repository/live drift](#repositorylive-drift)). Confirm every row on the host (`docker ps`, `docker inspect`, `docker volume ls`, the Backrest plan configuration) before changing storage or retiring a recovery path.

## Retained services

| Service | Status in this migration | Images | Persistent data | Secrets | Depends on |
| --- | --- | --- | --- | --- | --- |
| Actual Budget | **Proposed pilot: fresh install** ([plan](actual-budget/README.md)); legacy instance is not migrated | Legacy: `actual-server:latest` (floating). Pilot: `26.11.0` pinned by digest | Legacy bind `config/volumes/actual-data` (preserve); pilot uses a named volume | None in Compose | `proxy` network |
| Homepage | Candidate | `homepage:latest` (floating) | Bind `config/volumes/homepage/config` (`settings.yaml` is tracked; other config files may exist only on the host) | `config/env/homepage/.env` | Docker socket |
| Dozzle | Candidate | `dozzle:latest` (floating) | None | None | Docker socket (read access to all host containers and logs) |
| Stirling PDF + MCP adapter | Candidate after LibreChat decisions; the adapter depends on Open Terminal's workspace and needs rethinking when Open Terminal is retired | Server pinned by digest; adapter built locally (`local/stirling-pdf-mcp`) | Binds under `config/volumes/stirlingpdf/{trainingData,extraConfigs,customFiles,logs,pipeline}`; shares external volume `llm_terminal-home` | `config/env/stirlingpdf/mcp.env` | `llm_terminal-home`; LibreChat is a client |
| Personal Management | Candidate; complex | Built from private GitHub repo `main` (unpinned) | Bind `config/volumes/personal-management/data` (SQLite); read-only host path `/home/melissa/personal-management-mobile-documents-editor/.hermes/screenshots` | `config/env/personal-management/.env`; `personal-management/.env` (`GIT_AUTH_TOKEN`) | Hermes on the host; loopback port `127.0.0.1:8100` for host automations |
| `llm` stack: Ollama, Camofox, Camofox MCP, Open Terminal | Deferred: LibreChat dependency. **Open Terminal (and its adapter and Workspace panel) planned for retirement** | Ollama `latest` (floating); Camofox images pinned by tag; Open Terminal built locally | Repo-relative bind `llm/ollama` (models; re-downloadable); named volume `llm_terminal-home` (shared workspace); Camofox anonymous volume (no managed profile) | `config/env/llm/{camofox,open-terminal}.env` | Networks `llm_terminal`, `llm_browser` used by LibreChat |
| LibreChat + history MCP + MongoDB | **Deferred: being rebuilt** | Fork image `local/librechat-homelab:*` built outside this repo; history MCP built locally; `mongo:8.0.20` | Binds under `config/volumes/librechat/{images,uploads,logs,data,mongodb}`; `librechat/librechat.yaml` | `config/env/librechat/{.env,fork.env,history-mcp.env,pi-sync.env}`, `config/env/openrouter.env`, plus env files from `llm`, `stirlingpdf`, `pi-connectors`; VAPID keys must not change casually | `llm`, Stirling MCP, Pi connector, Executor (hosted later) |
| Pi Codex connector | **Planned for retirement**, with the laptop Pi gateway; not migrating | Built locally (`local/pi-codex-connector:<rev>`) | Bind `config/volumes/pi-connectors/codex` (OAuth `auth.json`) | `config/env/pi-connectors/{codex.key,librechat.env}` | Run from `/home/melissa/homelab-releases/pi-connectors-current/`, not the checkout |
| Executor (self-hosted) | **Not migrating** — moving to hosted | Pinned by version and digest | Named volume `executor_executor-user-data`; preserved inactive `executor_executor-data` | Retired credentials preserved; rollback in `/root/executor-manual-owner-backup/` | LibreChat MCP client |
| Backrest | Legacy recovery path until replaced | `backrest:latest` (floating) | Binds under `config/volumes/backrest/*`; mounts `/home/melissa/homelab/` read-write at `/userdata` | `config/volumes/backrest/config/config.json` (Restic repository password, S3 credentials; copy in Bitwarden) | DigitalOcean storage |
| Caddy + Tailscale sidecar | Replaced only after per-service cutover | Tailscale pinned; Caddy built locally with the Cloudflare DNS module | Named volume `caddy_tailscale-state` (sidecar identity); binds `config/volumes/caddy/{data,config}` (certificates) | `config/env/caddy/.env`; `/etc/homelab/caddy-dns.env` (host path outside the repo) | Cloudflare DNS, `proxy` network |
| Static site (`static/`) | Unknown | `nginx:alpine` (floating) | Serves the `static/` directory | None | No Caddy route exists; confirm whether it runs or is needed |

Host-level, not containers:

- **Hermes Agent:** native install pinned in `hermes/setup.sh`; state in `~/.hermes`, including API keys. Not a Dokploy target; needs its own backup entry.
- **Host Tailscale** (SSH, `100.126.9.60`), UFW rules, `/etc/homelab/`, and `/home/melissa/homelab-releases/` (connector release, config backups).
- **Laptop Pi session gateway:** runs on the laptop, outside the homelab; planned for retirement with the Pi connector. When retiring it, also remove the laptop's Tailscale ACL entry for the homelab.
- **Private rollback directories** under `/home/melissa/.local/state/librechat-fork/`.

## Retired-service data (preserve)

Do not delete, prune, or migrate it unless deletion is approved for that specific service:

- Nextcloud, Todo: `config/{volumes,env}/{nextcloud,todo}`.
- Open WebUI: `config/volumes/llm/openwebui/`, `config/env/llm/openwebui-terminal.env`.
- CLIProxyAPI: `config/{env,volumes}/cliproxyapi/` and its retained local image.
- Authentik, n8n, Paperless, Vikunja, Wetty, Komodo: placeholder directories under `config/{env,volumes}/`; may hold data on the host.
- Planned retirements, once the LibreChat rebuild no longer uses them: Open Terminal workspace volume `llm_terminal-home`, `config/env/llm/open-terminal.env`, Pi connector OAuth/keys under `config/{env,volumes}/pi-connectors/`, `/home/melissa/homelab-releases/pi-connectors*`, and the laptop gateway state.
- Legacy Actual Budget data in `config/volumes/actual-data`, after the fresh Dokploy instance replaces it.
- Executor after the hosted move: `executor_executor-user-data`, `executor_executor-data`, and `/root/executor-manual-owner-backup/`.

Archive these into the replacement backup scheme (for example, a one-time tarball to S3) before Backrest is retired. Alternatively, keep the Restic repository and its credentials for an agreed retention period.

## Backup coverage findings

- **Backrest probably does not cover named volumes.** Its only data mount is `/home/melissa/homelab/`, while Docker named volumes live under `/var/lib/docker/volumes/`. Unless a plan outside this repository covers them, `caddy_tailscale-state`, `llm_terminal-home`, `executor_executor-user-data`, and `executor_executor-data` have no backup. Check `config.json` on the host.
- **MongoDB and SQLite files are backed up while running.** Backrest copies live database files. Its snapshots of `config/volumes/librechat/mongodb`, Actual, and Personal Management may be inconsistent unless a hook stops writers or dumps them first. Confirm through a test restore before relying on them.
- **Host paths outside the checkout** (`/etc/homelab/`, `~/.hermes`, `homelab-releases`, rollback directories, `/root/executor-manual-owner-backup/`) are not under Backrest's mount.
- **Custom images are not backed up.** LibreChat fork, Open Terminal, adapters, the connector, Caddy, and Personal Management exist only as local images or build from sources outside this repo. Rebuilding requires each source revision. Pushing tagged images to a private registry would remove that dependency.

## Repository/live drift

Known places where the files in Git do not reproduce the running system:

1. **Open Terminal mode.** `llm/docker-compose.yml` builds an MCP-only image. `librechat/WORKSPACE.md` records that production runs upstream `0.14.0` in `run` mode with a separate `open-terminal-mcp` adapter, and that the MCP-only image must not be deployed.
2. **Terminal MCP adapter definition.** `librechat/docker-compose.terminal-mcp.yml` sets only the image of service `terminal-mcp`. No tracked Compose file defines that service (environment, network, command), so it cannot be recreated from Git.
3. **LibreChat image revision.** `docker-compose.fork.yml` is `7a7c003f1`, consistent with `librechat/terminal-mcp/README.md`. `librechat/FORK.md` still describes the `48f12a8f2` release.
4. **Startup order.** The root README's start commands omit the fork overlay, Pi connector, Personal Management, and the terminal adapter.
5. **Pi connector working directory.** It runs from a release directory, which changes its Compose project context and bind-path resolution.

Items 1, 2 and 5 go away with the planned Open Terminal and Pi retirements; don't spend effort reconciling them. Until those retirements happen, record the live definitions privately so the current deployment stays recoverable. Items 3 and 4 remain relevant to the LibreChat rebuild.

## Host audit checklist (read-only)

Run on the homelab and keep the output in the private recovery record, not in Git:

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect --format '{{.Name}} {{.Config.Image}} {{.Image}}' $(docker ps -q)
docker inspect --format '{{.Name}}{{range .Mounts}} {{.Type}}:{{or .Name .Source}}->{{.Destination}}{{end}}' $(docker ps -aq)
docker inspect --format '{{.Name}} {{index .Config.Labels "com.docker.compose.project.working_dir"}} {{index .Config.Labels "com.docker.compose.project.config_files"}}' $(docker ps -aq)
docker volume ls
docker network ls
sudo ss -tulpn
sudo ufw status verbose
sudo jq '.plans' /home/melissa/homelab/config/volumes/backrest/config/config.json
```

The Compose labels show which files and directories actually started each container. That resolves the drift items above.
