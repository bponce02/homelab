# Homelab

Self-hosted services on one Docker host (`melissa-v2`). Services are defined as Compose files in this repository, deployed with [Dokploy](https://dokploy.com), store data in named volumes backed up to S3, and are reachable only over Tailscale. The public blog runs separately on a Droplet and isn't covered here.

The migration to Dokploy is in progress: some services still run as hand-started Compose stacks behind Caddy (see [Legacy stack](#legacy-stack)).

## Layout

| Path | Contents |
| --- | --- |
| `<service>/compose.yaml` | A service deployed by Dokploy (`actual-budget`, `personal-management`) |
| `host/ufw-docker.rules` | Firewall rules that keep Docker-published ports Tailscale-only |
| `caddy/`, `backrest/`, `homepage/`, `dozzle/`, `stirlingpdf/`, `librechat/`, `llm/`, `static/` | Legacy Compose stacks, removed as each service moves to Dokploy |
| `config/` | Legacy configuration referenced by those stacks |

## Services

| Service | Runs on | URL | Data | Backup |
| --- | --- | --- | --- | --- |
| Actual Budget | Dokploy (`actual-budget`) | `actual.develium.dev` | Volume `actual-budget-kbggec_actual-data` | Dokploy volume backup, daily |
| Personal Management | Moving to Dokploy (`personal-management`) | `per.develium.dev` | Volume `<appName>_app-data` (SQLite and uploads) | Dokploy volume backup, daily |
| Homepage, Dozzle, Stirling PDF | Legacy | `homepage.`, `dozzle.`, `pdf.develium.dev` | Folders under `config/volumes/` | Backrest |
| LibreChat (with MongoDB, history MCP, Ollama, Camofox) | Legacy; being rebuilt | `librechat.develium.dev` | `config/volumes/librechat/`, `llm/ollama` | Backrest (Mongo copied live) |
| Executor | Legacy; moving to the hosted version | `executor.develium.dev` | Volume `executor_executor-user-data` | None (named volume) |
| Backrest, Caddy | Legacy infrastructure | `backrest.develium.dev` | `config/volumes/{backrest,caddy}`, volume `caddy_tailscale-state` | — |

## Network and access

- Clients reach services only over Tailscale. Each Dokploy service has its own DNS-only Cloudflare A record pointing to the host's Tailscale IP, `100.126.9.60`. The `*.develium.dev` wildcard still points to Caddy's Tailscale sidecar (`100.74.174.50`) for legacy services.
- Dokploy's Traefik serves HTTPS with Let's Encrypt certificates from the Cloudflare DNS challenge.
- UFW denies incoming traffic except on `tailscale0` and UDP 41641. `host/ufw-docker.rules` extends that to Docker-published ports. Ordinary UFW rules don't cover those, and Dokploy publishes 80, 443 and 3000. A LAN check on 2026-11-07 found every Dokploy, Swarm and SSH port blocked over IPv4 and IPv6.
- Dashboard: `https://dokploy.develium.dev`, with `http://100.126.9.60:3000` as a fallback.

## Bootstrap a host

Manual steps, in order. A Proxmox VM is the planned long-term host: use a full VM (not LXC), and add the Proxmox VM firewall (input `DROP`, allow UDP 41641) as an outer layer.

1. **OS and Tailscale.** Install Ubuntu Server 24.04, then Tailscale. Authorize the host and disable its key expiry. Confirm SSH works over its Tailscale IP.
2. **Firewall, before Dokploy.**
   ```bash
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow in on tailscale0 && sudo ufw allow 41641/udp && sudo ufw enable
   ```
   Append `host/ufw-docker.rules` to `/etc/ufw/after.rules` and `/etc/ufw/after6.rules`, run `sudo ufw reload`, and check that `sudo iptables -S DOCKER-USER` lists the rules.
3. **Dokploy `v0.31.0`.** Use the release installer (sha256 `66586207a55bb95f6eb7561e765bdba6d3563afae04a1161c033f9e3e020c79b`):
   ```bash
   curl -fsSLo install.sh https://github.com/Dokploy/dokploy/releases/download/v0.31.0/install.sh
   sudo ADVERTISE_ADDR=<tailscale-ip> DOKPLOY_VERSION=v0.31.0 sh install.sh
   ```
4. **HTTPS via Cloudflare DNS.** In `/etc/dokploy/traefik/traefik.yml`, replace the `letsencrypt` resolver's `email` and `httpChallenge` with `dnsChallenge` (`provider: cloudflare`, resolvers `1.1.1.1:53`, `1.0.0.1:53`). Put `CF_DNS_API_TOKEN=<token>` in `/etc/dokploy/traefik/cloudflare.env` (mode 600). The token needs Zone Read and DNS Edit on `develium.dev`. Then recreate Traefik with the token:
   ```bash
   sudo docker rm -f dokploy-traefik
   sudo docker run -d --name dokploy-traefik --restart always --network dokploy-network \
     --env-file /etc/dokploy/traefik/cloudflare.env \
     -v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
     -v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
     -v /var/run/docker.sock:/var/run/docker.sock:ro \
     -p 80:80/tcp -p 443:443/tcp -p 443:443/udp traefik:v3.6.25
   ```
   If Dokploy ever recreates Traefik (for example on an upgrade), check that the token is still set: `docker inspect dokploy-traefik --format '{{.Config.Env}}' | grep -c CF_DNS`.
5. **Dashboard domain.** Route `dokploy.develium.dev` to `http://dokploy:3000` in `/etc/dokploy/traefik/dynamic/dokploy.yml` (an HTTPS router with `certResolver: letsencrypt`, plus an HTTP router using the `redirect-to-https` middleware). Add its DNS-only A record.
6. **Owner account and S3.** Create the owner account. Add the S3 destination: DigitalOcean Spaces bucket `develium-dokploy-backups`, region `atl1`, endpoint `https://atl1.digitaloceanspaces.com`. Its key (in the password manager) is limited to that bucket.
7. **Platform backup.** Schedule Dokploy's web-server backup daily to that destination (currently `30 7 * * *` UTC, keep 14, encryption key included). To rebuild an existing setup on a new host, restore the latest platform backup onto the fresh install instead of reconfiguring by hand.

## Add a service to Dokploy

1. Write `<service>/compose.yaml`:
   - pin the image (tag and digest) or the build commit;
   - keep mutable data in named volumes only;
   - publish no host ports;
   - join the external `dokploy-network`;
   - read secrets as `${VAR}` from Dokploy's Environment tab.

   Repository-relative bind mounts don't survive Dokploy redeploys, and volume backups skip bind mounts.
2. Create the Compose service in Dokploy:
   - Git URL `https://github.com/bponce02/homelab.git`, the deployment branch, and `./<service>/compose.yaml`.
   - Add the domain (service, port, HTTPS, resolver `letsencrypt`).

   The Dokploy CLI (`dokploy compose create/update`, `dokploy domain create`) can do the same.
3. For existing data: stop the old container, `docker volume create <appName>_<volume>`, copy the data in (`cp -a`), then deploy. Compose adopts the existing volume.
4. Check the service over the Tailscale IP (`curl --resolve <host>:443:100.126.9.60 …`), then add its DNS-only A record. The specific record overrides the Caddy wildcard.
5. Add a volume backup (stop the container during the backup, keep 14). Run it once, then remove the old container and its Caddy route.

## Backups and recovery

- **Volumes:** each Dokploy service's named volumes are backed up to `develium-dokploy-backups`. Restore from the service's Volume Backups tab. **Always restore into a new volume name.** If the target volume exists and no container uses it, Dokploy deletes it before restoring. A restore of Actual into a new volume was tested on 2026-11-07: the databases passed integrity checks and the app booted with its data.
- **Platform:** the daily Dokploy backup holds its database, `/etc/dokploy` and the encryption key. It also contains the Cloudflare token and the S3 key, so keep the bucket private. Restore it only onto a fresh Dokploy install.
- **Legacy:** Backrest backs up `/home/melissa/homelab` hourly to the Spaces bucket `develium`. It doesn't cover named volumes, and it copies databases while they run. It stays until the last legacy service has moved.
- **Outside Dokploy, keep in the password manager:** the S3 key, the Cloudflare token, the Dokploy owner login, and Tailscale admin access.

## Legacy stack

Until each service moves, the server runs the old stacks from its own checkout, `/home/melissa/homelab`. That checkout has diverged from this repository: its files were edited in place. Treat it as the source of truth for those services:

```bash
cd /home/melissa/homelab && sudo docker compose -f <service>/docker-compose.yml up -d
```

Caddy (`caddy/`) runs inside a Tailscale sidecar container and serves the wildcard routes. Backrest (`backrest/`) has its configuration in Bitwarden.

## Retired (stopped; data preserved)

Don't delete or prune this data without explicit approval.

- **Open Terminal, `open-terminal-mcp`, `agent-desktop`:** stopped 2026-11-07. Volume `llm_terminal-home`, `config/env/llm/open-terminal.env`. LibreChat's terminal tools no longer work.
- **Pi Codex connector and laptop Pi gateway:** stopped 2026-11-07. `config/{env,volumes}/pi-connectors/`, the laptop's `pi-session-gateway` user service (disabled), and `/home/melissa/homelab-releases/`.
- **Open WebUI:** stopped 2026-11-07. `config/volumes/llm/openwebui/`.
- **Hermes:** stopped 2026-11-06. `~/.hermes` and its systemd user units.
- **Legacy Actual:** containers removed 2026-11-07. `config/volumes/actual-data`, `config/volumes/actual-mcp-v267`.
- **CLIProxyAPI, Nextcloud, Todo, Komodo, Authentik, n8n, Paperless, Vikunja, Wetty:** directories under `config/` and Komodo's `komodo_*` volumes.

Their Compose files and docs remain in Git history.
