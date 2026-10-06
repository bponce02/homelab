# Homelab Setup

Self-hosted homelab infrastructure with Docker and Tailscale-only HTTPS access.

`*.develium.dev` points to Caddy's Tailscale sidecar (`homelab-caddy`, `100.74.174.50`). The homelab's separate Tailscale connection (`100.126.9.60`) is used for SSH. The public blog runs separately on a Droplet through Cloudflare Tunnel.

## Tailscale and UFW

Caddy shares the Tailscale sidecar's network and reaches applications over Docker's `proxy` network. Neither Caddy nor the web applications publish ports on the host. Local integrations may bind to `127.0.0.1` only.

Tailscale controls access to Caddy; there is no additional proxy login. Applications retain their own authentication where configured. Anyone allowed to reach Caddy through Tailscale can reach all its application routes.

Both hosts use ordinary UFW rules for host services: allow Tailscale traffic and UDP 41641, deny other incoming connections. No custom Docker firewall rules are needed. Do not add all-interface Docker port mappings: they bypass ordinary UFW rules.

For a new sidecar, start it and open the authorization link in its logs:

```bash
sudo docker compose -f caddy/docker-compose.yml up -d tailscale
sudo docker compose -f caddy/docker-compose.yml logs tailscale
```

The `tailscale-state` volume preserves its identity. Do not delete it during upgrades. After authorization, start Caddy with `docker compose up -d` in `caddy/` and point the DNS-only wildcard A record to the sidecar's Tailscale IP. Check the device's key-expiry setting in the Tailscale admin console for unattended operation.

## AI Services

LibreChat runs at https://librechat.develium.dev with Ollama's local models, OpenRouter's hosted models, and Open Terminal/Camofox tools. Open WebUI and its `llm.develium.dev` route are removed from the repository configuration; its saved data is retained. See [chat service configuration and retirement steps](llm/README.md).

Two optional [Pi connectors](pi-connectors/README.md) provide Codex subscription inference through Pi's library and owner-only access to allowlisted Herdr/Pi sessions on the laptop. Codex Subscription is authenticated and enabled in LibreChat, with live streaming, function-call round-trip, and browser chat checks passing. Access requires a per-user connector key; it is not shared with all registered users. Local Pi remains inactive and its [endpoint example](librechat/pi-endpoints.example.yaml) is opt-in. CLIProxyAPI is unchanged.

CLIProxyAPI's management UI runs at https://cliproxy.develium.dev/management.html (Tailscale only). It has separate management/client keys and persistent OAuth storage. Subscription login must be completed by the owner before connecting chat clients. This is a single credential pool, not tenant-isolated hosting. See [CLIProxyAPI setup and login](cliproxyapi/README.md).

Executor's self-hosted integration catalog runs at https://executor.develium.dev (Tailscale only). Create the owner account through its first-run signup screen; no admin is bootstrapped. Connecting LibreChat to `http://executor:4788/mcp` requires a valid API key from the current owner. Configure integrations once in Executor; external providers may still require their own credentials or OAuth consent. No cloud integrations are migrated automatically.

- Compose: `executor/docker-compose.yml`, image pinned to version 1.6.10 and its digest; no published host ports or Docker socket.
- No bootstrap credentials are loaded. Retired credentials and the previous `executor_executor-data` volume are preserved but inactive; rollback configuration is in `/root/executor-manual-owner-backup/` on Homelab.
- Back up `executor_executor-user-data`, including the database and both encryption/session key files. Stop Executor before a file-level backup, or use a consistent volume snapshot.
- Private-network access from sandboxed code remains disabled. Add network access deliberately when configuring homelab integrations. This integration service does not replace Open Terminal or provide an autonomous background agent.

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/bponce02/homelab.git
cd homelab
```

### 2. Install Docker

Reference: [Docker Installation Guide](https://docs.docker.com/engine/install/ubuntu/)

```bash
# Add Docker's official GPG key
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

# Install Docker
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 3. Setup Backrest

1. Paste Backrest config into `config/volumes/backrest/config/config.json` (stored in Bitwarden)

2. Create Docker network:
```bash
sudo docker network create proxy
```

3. Start Backrest:
```bash
sudo docker compose -f backrest/docker-compose.yml up -d
```

4. With Caddy running, connect to Tailscale and open Backrest: `https://backrest.develium.dev/`

## Restore from Backup

### 1. Index and Restore Snapshot

1. In Backrest UI, index snapshots from DigitalOcean
2. Select snapshot to restore
3. Set restore path to: `/userdata/restore`
4. Start restore operation

### 2. Copy Restored Files

```bash
# Copy files from restore location to homelab directory
sudo cp -r /home/melissa/homelab/restore/* /home/melissa/homelab/
sudo rm -rf /home/melissa/homelab/restore
```

## Start All Services

```bash
# Start all containers
sudo docker compose -f actual-budget/docker-compose.yml up -d
sudo docker compose -f caddy/docker-compose.yml up -d
sudo docker compose -f dozzle/docker-compose.yml up -d
sudo docker compose -f homepage/docker-compose.yml up -d
sudo docker compose -f llm/docker-compose.yml up -d
sudo docker compose -f librechat/docker-compose.yml up -d
sudo docker compose -f executor/docker-compose.yml up -d
sudo docker compose -f stirlingpdf/docker-compose.yml up -d
```

Connect to Tailscale to access the homelab at its `*.develium.dev` hostnames.

Nextcloud and Todo are retired. Their Compose definitions and Caddy routes are removed; existing data and credentials under `config/volumes/{nextcloud,todo}` and `config/env/{nextcloud,todo}` are preserved for recovery. Do not delete them or prune their storage as part of service retirement.

Stirling PDF includes a bearer-authenticated MCP adapter for agent PDF tools. See [setup, shared workspace, and download links](stirlingpdf/README.md) before starting the updated Stirling PDF and LibreChat stacks.
