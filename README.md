# Homelab

Self-hosted services on one Docker host (`melissa-v2`). Services are defined as Compose files in this repository, deployed with [Dokploy](https://dokploy.com), store data in named volumes backed up to S3, and are reachable only over Tailscale. The public blog runs separately on a Droplet and isn't covered here.

Everything on the host now runs through Dokploy. The old hand-started Compose stacks, Caddy and Backrest are retired (see [Retired](#retired-data-preserved)).

## Layout

| Path | Contents |
| --- | --- |
| `<service>/compose.yaml` | A service deployed by Dokploy (`actual-budget`, `personal-management`) |
| `host/ufw-docker.rules` | Firewall rules that keep Docker-published ports Tailscale-only |

## Services

| Service | Runs on | URL | Data | Backup |
| --- | --- | --- | --- | --- |
| Actual Budget | Dokploy (`actual-budget`) | `actual.develium.dev` | Volume `actual-budget-kbggec_actual-data` | Dokploy volume backup, daily |
| Personal Management | Dokploy (`personal-management`); builds `bponce02/personal-management` `main` on each **Deploy** click (no auto-deploy: GitHub webhooks can't reach the private Dokploy) | `per.develium.dev` | Volume `personal-management-ppbblm_app-data` (SQLite and uploads) | Dokploy volume backup, daily |

## Network and access

- Clients reach services only over Tailscale. Each Dokploy service has its own DNS-only Cloudflare A record pointing to the host's Tailscale IP, `100.126.9.60`. There is no wildcard route any more.
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
4. Check the service over the Tailscale IP (`curl --resolve <host>:443:100.126.9.60 …`), then add its DNS-only A record.
5. Add a volume backup (stop the container during the backup, keep 14). Run it once, then remove the old container.

## Backups

Dokploy runs these backups automatically and uploads them to the private DigitalOcean Spaces bucket `develium-dokploy-backups` (region `atl1`, DigitalOcean account `personal`).

| What | Schedule (UTC) | Keeps | Bucket folder | See it in Dokploy |
| --- | --- | --- | --- | --- |
| Actual Budget data (volume `actual-budget-kbggec_actual-data`) | Daily 08:00 | 14 | `actual-budget-kbggec_actual_server/actual-budget/` | Homelab → actual-budget → **Volume Backups** |
| Personal Management data (volume `personal-management-ppbblm_app-data`) | Daily 08:15 | 14 | `personal-management-ppbblm_web/personal-management/` | Homelab → personal-management → **Volume Backups** |
| Dokploy itself (its database including every service's environment variables, `/etc/dokploy`, encryption key) | Daily 07:30 | 14 | `backup-bypass-auxiliary-matrix-xg1i1q/dokploy-platform/` | **Settings → Web Server**, backups section |

- Volume backups stop the app for a few seconds so its SQLite files are consistent, then start it again.
- Each schedule was run once by hand on 2026-11-07, and the archives are in the bucket. Actual's backup was also restored into a test volume: the databases passed integrity checks and the app booted with its data.
- The Dokploy backup contains secrets (environment variables, the Cloudflare token, the S3 key), so the bucket must stay private.
- **Old Backrest snapshots:** Backrest is retired, but its 62 snapshots of `/home/melissa/homelab` remain in the Spaces bucket `develium` (Restic repository; password in Bitwarden). The last one, `e5e4cbff` (2026-11-07 06:08 UTC), was taken after LibreChat and Stirling PDF were stopped, so it is a clean copy of all preserved data. Don't delete that bucket without explicit approval.

### Restore

- **One service's data:** in the service's **Volume Backups** tab, choose **Restore**, pick a backup file, and enter a **new** volume name. Point the service at that volume (or copy the data into place) and redeploy. Never restore into an existing volume name: if nothing is using that volume, Dokploy deletes it first.
- **The whole server** (for example, moving to the Proxmox VM): follow [Bootstrap a host](#bootstrap-a-host) steps 1–3 on the new machine, restore the latest Dokploy backup there, then restore each service's volume and redeploy.
- **Keep in the password manager** (needed when Dokploy itself is gone): the S3 key, the Cloudflare token, the Dokploy login, and Tailscale admin access.

## Retired (data preserved)

Don't delete or prune this data without explicit approval.

- **Open Terminal, `open-terminal-mcp`, `agent-desktop`:** containers removed 2026-11-07. Volume `llm_terminal-home`, `config/env/llm/open-terminal.env`.
- **Pi Codex connector and laptop Pi gateway:** container removed and gateway disabled 2026-11-07. `config/{env,volumes}/pi-connectors/`, the laptop's `pi-session-gateway` user service (disabled), and `/home/melissa/homelab-releases/`.
- **Open WebUI:** container removed 2026-11-07. `config/volumes/llm/openwebui/`.
- **Hermes:** stopped 2026-11-06. `~/.hermes` and its systemd user units.
- **Legacy Actual:** containers removed 2026-11-07. `config/volumes/actual-data`, `config/volumes/actual-mcp-v267`.
- **Legacy Personal Management:** container removed 2026-11-07. `config/volumes/personal-management/data`, `config/env/personal-management/.env`, unused volume `personal-management_app-data`.
- **Executor:** moved to the hosted version; container removed 2026-11-07. Volumes `executor_executor-user-data`, `executor_executor-data`, `executor_executor-local-data`, and `/root/executor-manual-owner-backup/`.
- **Ollama:** removed 2026-11-07. Models in `/home/melissa/homelab/llm/ollama` on the server (31 GB, re-downloadable).
- **Homepage, Dozzle, static site:** removed 2026-11-07. `config/volumes/homepage/`.
- **Blog on this host:** container removed 2026-11-07 (the blog runs on the Droplet). `config/volumes/blog/`.
- **LibreChat (MongoDB, history MCP), Camofox:** containers removed 2026-11-07, ahead of the rebuild. `config/volumes/librechat/` (496 MB, including MongoDB), `config/env/librechat/`, `config/env/llm/camofox.env`, `config/env/openrouter.env`, and the server checkout's `librechat/librechat.yaml`.
- **Stirling PDF:** container removed 2026-11-07. `config/volumes/stirlingpdf/`.
- **Caddy and its Tailscale sidecar:** containers removed 2026-11-07. `config/volumes/caddy/`, volume `caddy_tailscale-state` (the `homelab-caddy` tailnet device), `/etc/homelab/caddy-dns.env` (still the source of the Cloudflare token Dokploy uses).
- **Backrest:** container removed 2026-11-07. `config/volumes/backrest/` (configuration also in Bitwarden); snapshots in the Spaces bucket `develium`.
- **CLIProxyAPI, Nextcloud, Todo, Komodo, Authentik, n8n, Paperless, Vikunja, Wetty:** directories under `config/` and Komodo's `komodo_*` volumes.

Their Compose files and docs remain in Git history.
