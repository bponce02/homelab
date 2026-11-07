# Dokploy platform

Dokploy itself is not a Compose stack. Its official installer creates Swarm services and a Traefik container with `docker` commands. This directory holds what's needed to recreate the installation as currently deployed on `melissa-v2`. The steps are run by hand, not automated.

| File | Installed at |
| --- | --- |
| `traefik/traefik.yml` | `/etc/dokploy/traefik/traefik.yml`: static config. Resolver `letsencrypt` uses the Cloudflare DNS challenge |
| `traefik/dynamic/dokploy.yml` | `/etc/dokploy/traefik/dynamic/dokploy.yml`: dashboard at `dokploy.develium.dev` |
| `traefik/dynamic/middlewares.yml` | `/etc/dokploy/traefik/dynamic/middlewares.yml`: Dokploy's default HTTP→HTTPS redirect |

Not in Git (secrets or generated state):

- `/etc/dokploy/traefik/cloudflare.env`: `CF_DNS_API_TOKEN=…` (zone `develium.dev`, DNS edit and zone read), mode 600.
- `/etc/dokploy/s3-backups.env`: Spaces key for `develium-dokploy-backups`. A copy is in the password manager.
- `/etc/dokploy/traefik/dynamic/acme.json`: certificates. Regenerated automatically.
- Per-application files that Dokploy writes into `traefik/dynamic/`, plus the Dokploy Postgres database. Both are covered by Dokploy's platform backup, not by Git.

## Install on a fresh host

Prerequisites: [host preparation and firewall](../README.md#manual-bootstrap), including [`../host/ufw-docker.rules`](../host/ufw-docker.rules) applied and verified. Docker installed, and ports 80, 443 and 3000 free.

```bash
# 1. Pinned installer (review it before running)
curl -fsSLo install.sh https://github.com/Dokploy/dokploy/releases/download/v0.31.0/install.sh
echo "66586207a55bb95f6eb7561e765bdba6d3563afae04a1161c033f9e3e020c79b  install.sh" | sha256sum -c -
sudo ADVERTISE_ADDR=<tailscale-ip> DOKPLOY_VERSION=v0.31.0 sh install.sh

# 2. Traefik configuration from this directory
sudo install -m 644 dokploy/platform/traefik/traefik.yml /etc/dokploy/traefik/traefik.yml
sudo install -m 644 dokploy/platform/traefik/dynamic/dokploy.yml dokploy/platform/traefik/dynamic/middlewares.yml /etc/dokploy/traefik/dynamic/

# 3. Cloudflare token for the DNS challenge (value from the password manager)
sudo sh -c 'umask 077; printf "CF_DNS_API_TOKEN=%s\n" "<token>" > /etc/dokploy/traefik/cloudflare.env'

# 4. Recreate Traefik with the token
sudo docker rm -f dokploy-traefik
sudo docker run -d --name dokploy-traefik --restart always --network dokploy-network \
  --env-file /etc/dokploy/traefik/cloudflare.env \
  -v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
  -v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -p 80:80/tcp -p 443:443/tcp -p 443:443/udp traefik:v3.6.25
```

5. Point a DNS-only `dokploy.develium.dev` A record at the host's Tailscale IP.
6. Create the owner account at `https://dokploy.develium.dev` (or `http://<tailscale-ip>:3000`), then add the S3 destination (endpoint `https://atl1.digitaloceanspaces.com`, region `atl1`, bucket `develium-dokploy-backups`, provider DigitalOcean).
7. To recover an existing installation instead, restore the platform backup ([replacement-server recovery](../README.md#replacement-server-recovery)) after step 1.

## Keeping this in sync

These files are copies of the live configuration. After changing Traefik settings or the dashboard domain in Dokploy's UI, copy the changed files back here:

```bash
ssh Homelab 'sudo cat /etc/dokploy/traefik/traefik.yml' > dokploy/platform/traefik/traefik.yml
```

Upgrading Dokploy: bump the version and installer checksum here, run the release's `install.sh update`, then check that `dokploy-traefik` still has `CF_DNS_API_TOKEN`.
