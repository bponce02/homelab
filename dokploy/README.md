# Dokploy migration

Status: **Dokploy is installed on the current homelab (`melissa-v2`)** as of 2026-11-07, ahead of the Proxmox machine. No application has moved yet. DNS, application volumes and backups are unchanged. Bootstrap is a manual procedure documented here, not an automation project.

## Current installation

| Item | Value |
| --- | --- |
| Host | `melissa-v2` (Ubuntu 24.04.4, Docker 29.4.3), Tailscale `100.126.9.60` |
| Dokploy | `v0.31.0`, from the release installer `https://github.com/Dokploy/dokploy/releases/download/v0.31.0/install.sh` (sha256 `66586207a55bb95f6eb7561e765bdba6d3563afae04a1161c033f9e3e020c79b`) |
| Install command | `sudo ADVERTISE_ADDR=100.126.9.60 DOKPLOY_VERSION=v0.31.0 sh install.sh` |
| Components | Swarm services `dokploy` (`:3000`, host mode) and `dokploy-postgres` (`postgres:16`); container `dokploy-traefik` (`traefik:v3.6.25`, `:80`, `:443` TCP/UDP); overlay network `dokploy-network`; `/etc/dokploy` |
| Swarm | Single node, advertise address set to the Tailscale IP. The Wi-Fi LAN address comes from DHCP and may change |
| Firewall | [`host/ufw-docker.rules`](host/ufw-docker.rules) appended to `/etc/ufw/after.rules` and `after6.rules` (backups `*.bak-20261107T041456Z`). There is no Proxmox layer on this host, so this is the only boundary |
| Dashboard | **`https://dokploy.develium.dev`** (Let's Encrypt via Cloudflare DNS challenge; HTTP redirects to HTTPS). DNS-only A record → `100.126.9.60`; the wildcard still points to Caddy. `http://100.126.9.60:3000` stays as the recovery path |
| Traefik HTTPS | Resolver `letsencrypt` in `/etc/dokploy/traefik/traefik.yml` changed from `httpChallenge` to `dnsChallenge` (provider `cloudflare`, resolvers `1.1.1.1:53`/`1.0.0.1:53`). Placeholder ACME email removed. Token: `CF_DNS_API_TOKEN` in root-only `/etc/dokploy/traefik/cloudflare.env`, copied from Caddy's `/etc/homelab/caddy-dns.env` (zone `develium.dev`: DNS edit, zone read). Rotating it means updating both files |
| Dashboard route | `/etc/dokploy/traefik/dynamic/dokploy.yml`, written by hand. Setting *Server Domain* in Dokploy's UI rewrites this file |
| Config backups | `/etc/dokploy/backups-20261107T042631Z/` (original `traefik.yml` and `dokploy.yml`) |
| S3 destination | Dokploy destination **DigitalOcean Spaces (atl1)**: bucket `develium-dokploy-backups` (private, `atl1`, DigitalOcean account `personal`), endpoint `https://atl1.digitaloceanspaces.com`. Spaces key `dokploy-backups` (`DO80126NW4ZXQPCAWQBA`) is limited to `readwrite` on this bucket and denied on Backrest's `develium`. Recovery copy: root-only `/etc/dokploy/s3-backups.env` on the host; also keep it in the password manager. Verified 2026-11-07: put, list and delete through Dokploy's rclone |

Privacy checks, 2026-11-07, from a laptop on the same Wi-Fi LAN:

- Over Tailscale: `:3000` answered (307 redirect to setup); `:80` and `:443` answered (Traefik 404).
- LAN IPv4 `192.168.0.109`: ports 22, 80, 443, 3000, 2377, 7946 and 8642 all timed out, while ping succeeded (positive control).
- LAN IPv6 link-local: ports 22, 80, 443 and 3000 all timed out, while ping succeeded. The host has no global IPv6 address.
- The existing Caddy routes (Homepage, Actual, LibreChat, Personal Management) still return 200, and containers still reach the internet.

Traefik was recreated with the installer's settings plus the token file:

```bash
sudo docker run -d --name dokploy-traefik --restart always --network dokploy-network \
  --env-file /etc/dokploy/traefik/cloudflare.env \
  -v /etc/dokploy/traefik/traefik.yml:/etc/traefik/traefik.yml \
  -v /etc/dokploy/traefik/dynamic:/etc/dokploy/traefik/dynamic \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -p 80:80/tcp -p 443:443/tcp -p 443:443/udp traefik:v3.6.25
```

If Dokploy ever recreates Traefik (Web Server → Traefik actions, upgrades), check that `CF_DNS_API_TOKEN` is still set: `docker inspect dokploy-traefik --format '{{.Config.Env}}' | grep -c CF_DNS`. If it isn't, add it under Traefik's environment settings in the UI. Application domains in Dokploy should use the `letsencrypt` certificate resolver, which now issues certificates through DNS.

The Proxmox host and VM steps below remain the long-term target. Moving Dokploy there later means a [replacement-server recovery](#replacement-server-recovery).

- [Service and data inventory](INVENTORY.md): retained services, data, secrets, backup-coverage gaps, and repository/live drift.
- [Platform](platform/README.md): Dokploy's own installation: pinned installer, Traefik config, dashboard route, and rebuild steps.
- [Pilot: Actual Budget](actual-budget/README.md): proposed first stack, a fresh install with a backup/restore test and rollback.

Dokploy behavior below was checked against its documentation on 2026-11-06. Re-check against the installed release.

## Scope

Target: Git-defined Compose stacks deployed by Dokploy, named volumes for persistent application data, off-server S3 backups, and private access through host-level Tailscale and Traefik.

- Executor: moving to the hosted service; do not migrate the self-hosted instance into Dokploy. Keep its data and current service until hosted onboarding and integration replacement are verified. Hosted data migration/export capabilities have not been established.
- LibreChat and the hub: being rebuilt; final deployment details are pending. Keep the current deployment unchanged and do not design its Dokploy stack until those details are settled.
- Other services: see the [inventory](INVENTORY.md). Actual Budget is the proposed pilot, redone as a fresh install rather than migrated.
- Open Terminal and the Pi connection (connector and laptop gateway): planned for retirement; not migrating. Preserve their data when retired.
- Hermes: retired (stopped and disabled 2026-11-06, data preserved). A future agent backend gets its own Proxmox VM, outside Dokploy; its design is pending.
- Public blog: separate Droplet deployment; excluded from this migration.
- Retired-service data: preserve until explicitly approved for deletion.

Existing Compose files and the root README describe the current deployment. Do not run old and new deployments against the same writable data. Backrest remains the recovery path until the new backups pass restoration tests.

## Manual bootstrap

### 1. Prepare the host

Target: a **VM on a new Proxmox machine**, separate from the current homelab. The existing services keep running untouched until each one is cut over.

**Proxmox host**

1. Install Proxmox VE. Keep its web UI (`:8006`) and SSH reachable only from the LAN or the Proxmox host's own Tailscale connection; never forward them from the router.
2. Record the Proxmox version, storage layout and root recovery method in the private recovery record.

**Dokploy VM**

Use a full VM, not an LXC container. Docker and Swarm inside LXC need extra privileges and are harder to firewall and restore.

1. Create the VM with Ubuntu Server 24.04 LTS, the QEMU guest agent, and the network device's **Firewall** checkbox enabled. Leave the Proxmox console as the recovery path.
2. Size it for everything planned, plus room for image builds and backup staging. Suggested starting point: 4 vCPU, 8 GiB RAM, 100 GiB disk. Grow later; Proxmox can resize disks.
3. Install Tailscale in the VM using the official instructions and authorize it interactively. Disable key expiry for this device in the admin console. Verify SSH over its Tailscale address.
4. Record the VM's Tailscale IP and intended DNS names in the private recovery record.

No Docker subnet advertisement is required for the intended ingress design: clients reach the VM over Tailscale, and Traefik reaches containers. Do not enable subnet routing or Tailscale SSH merely because the example guide does; these are separate access decisions.

### 2. Establish the network boundary

This is a prerequisite to installation, not a post-install cleanup task. Dokploy publishes ports 80, 443 (Traefik) and 3000 (dashboard) on all interfaces, and Swarm listens on 2377, 7946 and 4789. Installing Tailscale does not make any of them private, and ordinary UFW input rules do not cover Docker-published ports.

Two independent layers, both configured before installing Dokploy:

**Layer 1: Proxmox VM firewall** (outside the VM, so nothing inside it can bypass it)

1. Datacenter → Firewall: enable it. First confirm the Proxmox host's own rules still allow your management access (`:8006`, SSH) from the LAN, or you'll lock yourself out of the UI. The console on the physical machine is the fallback.
2. VM → Firewall → Options: enable it; input policy `DROP`, output policy `ACCEPT`. Keep the defaults for MAC filter and NDP (needed for IPv6).
3. VM → Firewall → Rules: one rule, `IN ACCEPT`, protocol `udp`, destination port `41641` (Tailscale direct connections). Rules apply to IPv4 and IPv6.

Tailscale still works: its outbound connections and their replies are allowed, and it can relay through DERP if direct connections fail. The LAN can reach no TCP port on the VM.

**Layer 2: UFW plus `DOCKER-USER` inside the VM** (in case the VM is ever moved, cloned or its NIC firewall disabled)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw allow 41641/udp
sudo ufw enable
```

Then append [`host/ufw-docker.rules`](host/ufw-docker.rules) to `/etc/ufw/after.rules` and `/etc/ufw/after6.rules` and reload. Forwarded traffic to published ports is then accepted only from Tailscale and Docker's own bridges. On the old homelab this file was written but never installed. Verify that the chain is populated (`sudo iptables -S DOCKER-USER`), not just that the file exists.

The rules must not break Dokploy's own traffic (Traefik → containers, builds pulling images, backups uploading to S3). Test every check in [Verify privacy](#4-verify-privacy) after installation, and again after each Dokploy upgrade.

### 3. Install Dokploy

Follow the official [installation guide](https://docs.dokploy.com/docs/core/installation). Choose a stable release, use its release-specific installer, and record the version and installer URL in the private recovery record. Review the installer before running it with root privileges. It installs Docker if needed and initializes the platform.

For reproducibility, use the selected release's installer rather than an unversioned latest installer. Follow the guide's advertise-address instructions if Swarm must use a specific host interface; an advertise address is not a firewall or listener restriction.

1. Access the dashboard over Tailscale and create the owner account.
2. Configure Git access without placing credentials in this repository.
3. Configure an off-server S3 destination and test access. Done on the current host (see [Current installation](#current-installation)): a new DigitalOcean Spaces bucket in the `personal` doctl context/account, separate from Backrest's `develium` bucket (which is in `atl1`; using the same region keeps one endpoint). Give Dokploy a key scoped to that bucket (`readwrite`), not a full-access key, and keep a copy of it in the password manager.
4. Configure Traefik HTTPS using Cloudflare DNS challenges for private application domains. Store the scoped DNS token securely, not in Git.
5. Validate a temporary hostname before changing existing application DNS.
6. Configure a private HTTPS dashboard domain. Only remove direct dashboard port access after verifying the alternate route and recovery access.

Keep the wildcard DNS record pointed at the existing Caddy sidecar during migration. Move individual service records to the new host's Tailscale IP only after each service passes its checks. DNS records must be DNS-only, not Cloudflare-proxied, for this private-address design.

### 4. Verify privacy

From an authorized Tailscale client, verify dashboard and application HTTPS. From a non-Tailscale LAN client and an external connection, verify the dashboard, proxy, and application ports are not accessible through non-Tailscale addresses. Test IPv6 where enabled. Confirm no application publishes unnecessary host ports.

Concrete checks, recording the results in the private recovery record:

- From a LAN device without Tailscale, with `<lan-ip>` the VM's LAN address: `nc -vz -w3 <lan-ip> 22`, then the same for ports `80`, `443`, `3000`, `2377` and `7946`. All must time out. Repeat for the VM's IPv6 address if it has one (`ip -6 addr` in the VM).
- Temporarily disable the Proxmox VM firewall and repeat. The same ports must still time out, which proves layer 2 on its own. Re-enable it.
- From a Tailscale client: `https://<dokploy-domain>` and the pilot's hostname load with valid certificates.
- Inside the VM: `sudo ss -tlpn` and `docker ps --format '{{.Names}} {{.Ports}}'`. Account for every listener.

## Per-service migration checklist

- Identify the authoritative deployed image, configuration, secrets, dependencies, and all persistent paths.
- Pin the image version/digest. Publish custom images or provide a reproducible build from an exact source revision.
- Define the new stack under `dokploy/<service>/compose.yaml` only after its scope is settled.
- Use named volumes for mutable data. Changing a bind mount to a named volume does not copy existing files.
- Record the actual Dokploy Compose project and volume names; do not assume they match legacy names. Dokploy documents Compose volumes as `{appName}_{volumeName}`.
- Attach routed services to the external `dokploy-network` and configure domains in Dokploy, not with published ports.
- Use supported File Mounts or another deployment-safe mechanism for static configuration. Repository-relative bind mounts do not survive redeployments: each deployment re-clones the repository. Dokploy's `../files` directory persists, but it is a bind mount and **not covered by volume backups**. Use it only for configuration that is also kept in Git or the recovery record, never for mutable data.
- Supply secrets through Dokploy or an appropriate secret provider, with an independent recovery copy where necessary. Dokploy UI environment values require explicit Compose references or `env_file` to reach containers.
- Take a verified backup, stop all writers, and copy data into a separate target volume while preserving ownership and permissions. Keep the original untouched.
- For databases, prefer a supported logical backup/restore workflow. A database inside an arbitrary Compose stack is not automatically a Dokploy-managed database.
- Rehearse restoration on an isolated stack. Prevent duplicate schedulers, notifications, OAuth callbacks, or external integration actions during testing.
- Validate account access, representative data, integrations, and application health before DNS cutover.
- Define rollback before accepting new writes. Returning to an old volume after new writes loses those writes unless data is reconciled.

## Backup policy and recovery

Configure three independent layers as applicable:

1. **Platform:** scheduled Dokploy backup of its PostgreSQL database and `/etc/dokploy` to S3. This is not a backup of every application's data.
2. **Volumes:** scheduled backups of every required named volume. Enable container shutdown for file-level backups where consistency requires it; coordinate all writers for shared volumes.
3. **Databases:** supported database dumps and restoration, plus any application files and keys needed alongside the database.

Record schedules, acceptable data loss, retention, S3 permissions, and restoration results. Verify retention and encryption capabilities against the installed release rather than assuming defaults. Platform backups may contain credentials and must be protected accordingly.

Keep S3 recovery credentials, required encryption keys, tailnet recovery access, and the platform version outside Dokploy in a password manager. Avoid the circular dependency of needing the lost Dokploy instance to retrieve its own backups.

### Replacement-server recovery

1. Complete the manual bootstrap with a compatible Dokploy version and working private dashboard access.
2. Supply S3 recovery credentials and restore the Dokploy platform backup. This replaces the destination platform database and `/etc/dokploy`; use a clean instance, not another active installation.
3. Keep application writers and deployment automation stopped while restoring data. Verify this behavior on the selected release during rehearsal.
4. Restore named volumes using the recorded target names. Dokploy documents that the restore target must not already exist; use fresh targets where possible, never delete a production volume just to satisfy this condition.
5. Restore databases through their supported workflow. Do not run application migrations against empty or partially restored storage.
6. Deploy in dependency order, restore required secrets, and verify account access and data before enabling background jobs and traffic.
7. Update platform IP settings, DNS, and Git integrations as necessary. Recheck private access and backups.

### Retiring Backrest

Retire it only after every retained service and host-level dependency has a replacement recovery source and a fresh-host recovery test has passed. Existing Restic snapshots are not directly importable through Dokploy's restore UI. Preserve access to those snapshots and their credentials for the agreed retention period, including archived services not being migrated.

## Next decisions

1. Legacy backup gaps from the [audit](INVENTORY.md#live-audit-2026-11-06) (named volumes, live database copies) are accepted until migration: the legacy host is being replaced, so they won't be fixed in place. Each migrated service must get correct backups in Dokploy instead.
2. Pilot: fresh Actual Budget install (confirmed). Whether the new instance needs an Actual MCP server is deferred.
3. Dokploy setup on the current host is complete: owner account, Cloudflare DNS challenge, `dokploy.develium.dev`, S3 destination. Next: schedule the Dokploy platform backup to S3, then deploy the Actual pilot. The Proxmox move happens later.
4. Decide where custom images will live (private registry or documented rebuild), and how secrets will be recorded outside Dokploy.
5. Apply hub/LibreChat deployment details when the rebuild settles them.

## References

- [Tailscale](https://docs.dokploy.com/docs/core/guides/tailscale)
- [Installation](https://docs.dokploy.com/docs/core/installation)
- [Compose and mounts](https://docs.dokploy.com/docs/core/docker-compose)
- [Platform backup/restore](https://docs.dokploy.com/docs/core/backups)
- [Volume backup/restore](https://docs.dokploy.com/docs/core/volume-backups)
- [Database backups](https://docs.dokploy.com/docs/core/databases/backups)
- [Database restore](https://docs.dokploy.com/docs/core/databases/restore)
