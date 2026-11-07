# Service and data inventory

Sources: this repository at commit `5defd84`, its service READMEs, and a read-only audit of the homelab (`melissa-v2`) on 2026-11-06 ([findings](#live-audit-2026-11-06)). The tables describe the repository. Where the audit differs, the audit wins.

## Retained services

| Service | Status in this migration | Images | Persistent data | Secrets | Depends on |
| --- | --- | --- | --- | --- | --- |
| Actual Budget | **Moving to Dokploy first, with its data** ([plan](actual-budget/README.md)) | Legacy: `actual-server:latest` (floating). Dokploy: `26.11.0` pinned by digest (legacy runs 26.7.0) | Legacy bind `config/volumes/actual-data` (3.2 MB; copied, then preserved); Dokploy uses a named volume | None in Compose | `proxy` network |
| Homepage | Candidate | `homepage:latest` (floating) | Bind `config/volumes/homepage/config` (`settings.yaml` is tracked; other config files may exist only on the host) | `config/env/homepage/.env` | Docker socket |
| Dozzle | Candidate | `dozzle:latest` (floating) | None | None | Docker socket (read access to all host containers and logs) |
| Stirling PDF + MCP adapter | Candidate after LibreChat decisions; the adapter depends on Open Terminal's workspace and needs rethinking when Open Terminal is retired | Server pinned by digest; adapter built locally (`local/stirling-pdf-mcp`) | Binds under `config/volumes/stirlingpdf/{trainingData,extraConfigs,customFiles,logs,pipeline}`; shares external volume `llm_terminal-home` | `config/env/stirlingpdf/mcp.env` | `llm_terminal-home`; LibreChat is a client |
| Personal Management | **Good candidate after the update.** Upstream `7af02cc96` (2026-11-06) removed Hermes chat, quota widgets and remote audio | Built from the private repo; pin a commit. The running container is the old August build | Live: bind `config/volumes/personal-management/data` (SQLite and uploads). Upstream Compose now uses a named volume `app-data` at `/app/data` (`MEDIA_ROOT=/app/data/media`). An unused `personal-management_app-data` volume also exists on the host; inspect it before assuming it's empty | `config/env/personal-management/.env` (Django secret, plus now-obsolete Hermes keys); build-time `GIT_AUTH_TOKEN` | No longer depends on Hermes. Upstream publishes `8000:8000`: drop that in Dokploy and use a domain. Its data is real, so migrate it rather than starting fresh, with a consistent SQLite backup per its README |
| `llm` stack: Ollama, Camofox, Camofox MCP, Open Terminal | Deferred: LibreChat dependency. **Open Terminal (and its adapter and Workspace panel) planned for retirement** | Ollama `latest` (floating); Camofox images pinned by tag; Open Terminal built locally | Repo-relative bind `llm/ollama` (models; re-downloadable); named volume `llm_terminal-home` (shared workspace); Camofox anonymous volume (no managed profile) | `config/env/llm/{camofox,open-terminal}.env` | Networks `llm_terminal`, `llm_browser` used by LibreChat |
| LibreChat + history MCP + MongoDB | **Deferred: being rebuilt** | Fork image `local/librechat-homelab:*` built outside this repo; history MCP built locally; `mongo:8.0.20` | Binds under `config/volumes/librechat/{images,uploads,logs,data,mongodb}`; `librechat/librechat.yaml` | `config/env/librechat/{.env,fork.env,history-mcp.env,pi-sync.env}`, `config/env/openrouter.env`, plus env files from `llm`, `stirlingpdf`, `pi-connectors`; VAPID keys must not change casually | `llm`, Stirling MCP, Pi connector, Executor (hosted later) |
| Pi Codex connector | **Planned for retirement**, with the laptop Pi gateway; not migrating | Built locally (`local/pi-codex-connector:<rev>`) | Bind `config/volumes/pi-connectors/codex` (OAuth `auth.json`) | `config/env/pi-connectors/{codex.key,librechat.env}` | Audit: runs from the host checkout `/home/melissa/homelab/pi-connectors` (the README's release-directory path is out of date) |
| Executor (self-hosted) | **Not migrating** — moving to hosted | Pinned by version and digest | Named volume `executor_executor-user-data`; preserved inactive `executor_executor-data` | Retired credentials preserved; rollback in `/root/executor-manual-owner-backup/` | LibreChat MCP client |
| Backrest | Legacy recovery path until replaced | `backrest:latest` (floating) | Binds under `config/volumes/backrest/*`; mounts `/home/melissa/homelab/` read-write at `/userdata` | `config/volumes/backrest/config/config.json` (Restic repository password, S3 credentials; copy in Bitwarden) | DigitalOcean storage |
| Caddy + Tailscale sidecar | Replaced only after per-service cutover | Tailscale pinned; Caddy built locally with the Cloudflare DNS module | Named volume `caddy_tailscale-state` (sidecar identity); binds `config/volumes/caddy/{data,config}` (certificates) | `config/env/caddy/.env`; `/etc/homelab/caddy-dns.env` (host path outside the repo) | Cloudflare DNS, `proxy` network |
| Static site (`static/`) | Unknown | `nginx:alpine` (floating) | Serves the `static/` directory | None | No Caddy route exists; confirm whether it runs or is needed |

Host-level, not containers:

- **Hermes Agent: retired 2026-11-06.** `hermes-gateway.service` and `hermes-usage-snapshot.timer` (systemd user units) were stopped and disabled. Unit files and `~/.hermes` (2.9 GiB, including API keys) are preserved. It is not being migrated.
- **Future agent backend:** the agent that replaces it needs its own VM on the Proxmox machine, separate from the Dokploy VM. Its design is pending; Dokploy does not host it.
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
- Legacy Actual Budget data in `config/volumes/actual-data`, after the Dokploy instance replaces it.
- Hermes: `~/.hermes`, its systemd user units, `hermes/usage-snapshot.py` output, and `/home/melissa/personal-management-mobile-documents-editor/.hermes/screenshots`.
- Executor after the hosted move: `executor_executor-user-data`, `executor_executor-data`, and `/root/executor-manual-owner-backup/`.

Archive these into the replacement backup scheme (for example, a one-time tarball to S3) before Backrest is retired. Alternatively, keep the Restic repository and its credentials for an agreed retention period.

## Backup coverage findings

- **Backrest does not cover named volumes** (confirmed by the audit). Its only data mount is `/home/melissa/homelab/`, while Docker named volumes live under `/var/lib/docker/volumes/`.
- **MongoDB and SQLite files are backed up while running** (confirmed: no hooks). Snapshots of `config/volumes/librechat/mongodb`, Actual, and Personal Management may be inconsistent. Confirm through a test restore before relying on them.
- **Host paths outside the checkout** (`/etc/homelab/`, `~/.hermes`, `homelab-releases`, rollback directories, `/root/executor-manual-owner-backup/`) are not under Backrest's mount.
- **Custom images are not backed up.** LibreChat fork, Open Terminal, adapters, the connector, Caddy, and Personal Management exist only as local images or build from sources outside this repo. Rebuilding requires each source revision. Pushing tagged images to a private registry would remove that dependency.

## Live audit (2026-11-06)

Read-only: `docker ps/inspect`, volumes, networks, listeners, UFW and iptables, Backrest plans, and the host checkout's Git state. Nothing was changed.

### The host checkout is the real source, not this repository

- `/home/melissa/homelab` is on `main` at `6efb73f`, 20 commits behind this repository, with extensive uncommitted edits and untracked files. Deployments have been made by editing files on the host.
- Compose files identical to this repository: `backrest`, `caddy/docker-compose.yml`, `dozzle`, `executor`, `homepage`, `pi-connectors`, `static`, `librechat/docker-compose.fork.yml`, and Homepage `settings.yaml`.
- Different on the host: `actual-budget`, `caddy/Caddyfile`, `librechat/docker-compose.yml` (adds `agent-desktop` and `terminal-mcp`), `librechat.yaml`, `llm` (Open WebUI still defined; upstream Open Terminal `0.14.0` with 4 CPUs/6 GiB), `personal-management`, `stirlingpdf` (no MCP adapter, unpinned image), and the LibreChat overlays.
- Untracked on the host only: `actual-budget/actual-mcp/` (an Actual MCP server built at `actual-api-26.7.0`), `caddy/FIREWALL.md`, `caddy/ufw-docker.rules`, `caddy-tailscale-staging/`, and env files.

Consequence: a rebuild from this repository would not reproduce production. For services moving to Dokploy, the new `dokploy/<service>/` definitions become the source. For the rest, copy the live files into the private recovery record before changing anything.

### Running containers not described by the repository

- `agent-desktop` (`local/librechat-agent-desktop:0.3.3`, LibreChat project) uses the `llm_terminal-home` volume. Retire it with Open Terminal.
- `open-terminal-mcp`: defined in the host's `librechat/docker-compose.yml`.
- `open-webui` `v0.11.4`: still running with `WEBUI_AUTH=false`. Its repository retirement was never deployed.
- `actual-budget-actual_mcp-1`: Actual MCP on `127.0.0.1:3001`, data in `config/volumes/actual-mcp-v267`. The Dokploy Actual stack does not include it. Decide whether the new instance needs an MCP server.
- Stopped: `blog` (now on the Droplet), Personal Management test containers, and a buildx builder.
- Not running: `stirling-pdf-mcp`, Nextcloud, Todo. The live Caddyfile still routes `todo`, `nextcloud`, and `llm` (Open WebUI).

### Storage and backups

- **Backrest:** one plan, `s3-homelab`, backs up `/userdata` (= `/home/melissa/homelab`) **hourly**. It keeps 24 hourly, 30 daily and 12 monthly snapshots, has **no hooks**, and stores them in the DigitalOcean Spaces bucket `develium` (`atl1`).
- **Confirmed: no named volume is backed up.** Unprotected:
  - `caddy_tailscale-state`, `llm_terminal-home`
  - `executor_executor-user-data`, `executor_executor-data`, `executor_executor-local-data`
  - `personal-management_app-data`
  - `komodo_{keys,mongo-config,mongo-data}` (retired Komodo)
  - two anonymous volumes (Camofox profile, Mongo `configdb`)
- **Confirmed: databases are copied live** (Mongo, SQLite for Actual, Personal Management, Open WebUI). Hourly snapshots may be internally inconsistent.
- Retired data present on the host: Nextcloud, Authentik and Todo directories under `config/volumes/`, the Komodo volumes, and `blog` under `config/volumes/blog/`.

### Network exposure

- Only loopback ports are published (`127.0.0.1:8100` Personal Management, `127.0.0.1:3001` Actual MCP). No container is reachable from the LAN through Docker.
- **The documented Docker firewall rules were not active.** `caddy/FIREWALL.md` (host only) said `ufw-docker.rules` was installed in `/etc/ufw/after*.rules`, but the live `DOCKER-USER` chains were empty. Fixed on 2026-11-07, before Dokploy was installed: [`host/ufw-docker.rules`](host/ufw-docker.rules) is now active for IPv4 and IPv6.
- UFW: deny incoming; allow `tailscale0`, `docker0`, `br+`, UDP 41641 (IPv4 and IPv6).
- Host listeners on all interfaces: SSH `:22` and Hermes `:8642`. Both were blocked from the LAN by UFW, not by their bind address. Hermes has since been stopped.
- The host uses Wi-Fi (`wlp0s20f3`, `192.168.0.109`); `eno1` is down.

## Repository/live drift

The [live audit](#live-audit-2026-11-06) supersedes this list: most service files differ between this repository and the host. Specific items found before the audit:

1. **Open Terminal mode.** `llm/docker-compose.yml` builds an MCP-only image; production runs upstream `0.14.0` in `run` mode.
2. **Terminal MCP adapter.** It is defined only in the host's `librechat/docker-compose.yml`, not in this repository.
3. **LibreChat image revision.** `docker-compose.fork.yml` (`7a7c003f1`) matches the host; `librechat/FORK.md` describes the earlier `48f12a8f2` release.
4. **Startup order.** The root README's start commands omit the Pi connector, Personal Management, and the terminal adapter.

Items 1 and 2 go away with the planned Open Terminal and Pi retirements; don't spend effort reconciling them. Item 3 and 4 remain relevant to the LibreChat rebuild.

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
