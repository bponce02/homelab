# Dokploy migration

Status: preparation only. No live services, DNS records, volumes, or backups have been changed. Bootstrap is a manual procedure documented here, not an automation project.

- [Service and data inventory](INVENTORY.md): retained services, data, secrets, backup-coverage gaps, and repository/live drift.
- [Pilot: Actual Budget](actual-budget/README.md): proposed first stack, a fresh install with a backup/restore test and rollback.

Dokploy behavior below was checked against its documentation on 2026-11-06. Re-check against the installed release.

## Scope

Target: Git-defined Compose stacks deployed by Dokploy, named volumes for persistent application data, off-server S3 backups, and private access through host-level Tailscale and Traefik.

- Executor: moving to the hosted service; do not migrate the self-hosted instance into Dokploy. Keep its data and current service until hosted onboarding and integration replacement are verified. Hosted data migration/export capabilities have not been established.
- LibreChat and the hub: being rebuilt; final deployment details are pending. Keep the current deployment unchanged and do not design its Dokploy stack until those details are settled.
- Other services: see the [inventory](INVENTORY.md). Actual Budget is the proposed pilot, redone as a fresh install rather than migrated.
- Open Terminal and the Pi connection (connector and laptop gateway): planned for retirement; not migrating. Preserve their data when retired.
- Public blog: separate Droplet deployment; excluded from this migration.
- Retired-service data: preserve until explicitly approved for deletion.

Existing Compose files and the root README describe the current deployment. Do not run old and new deployments against the same writable data. Backrest remains the recovery path until the new backups pass restoration tests.

## Manual bootstrap

### 1. Prepare the host

Prefer an isolated replacement host or VM for rehearsal. Installing Dokploy on the production host changes Docker/Swarm and networking; do not treat it as a harmless application install.

1. Install a supported Linux distribution, configure SSH and retain console recovery access.
2. Provision storage and ensure enough capacity for application data, backup staging, and builds.
3. Install Tailscale using its official installation instructions and authorize the host interactively. Verify SSH through its Tailscale address before restricting other access.
4. Review tailnet access rules and device key expiry for unattended operation.
5. Record the host's Tailscale IP and intended DNS names in the private recovery record.

No Docker subnet advertisement is required for the intended ingress design: clients reach the host over Tailscale, and Traefik reaches containers. Do not enable subnet routing or Tailscale SSH merely because the example guide does; these are separate access decisions.

### 2. Establish the network boundary

This is a prerequisite to installation, not a post-install cleanup task. Dokploy publishes dashboard and proxy ports; merely installing Tailscale does not make them private.

- Reserve ports 80, 443, and 3000 for Dokploy/Traefik.
- Use upstream isolation during initial setup, and implement a verified Docker/Swarm-aware ingress policy before production cutover.
- Ordinary UFW incoming rules alone are insufficient for Docker-published ports.
- A provider firewall is an option on a VPS. For a home server, explicitly cover unwanted LAN, WAN, and IPv6 access; lack of router port forwarding alone does not establish a Tailscale-only boundary.
- Do not expose Docker/Swarm management ports to untrusted networks.

The exact host firewall implementation is not yet selected. Do not proceed on an exposed host until it is selected and tested. Keep the existing Caddy/Tailscale sidecar unchanged in the meantime.

### 3. Install Dokploy

Follow the official [installation guide](https://docs.dokploy.com/docs/core/installation). Choose a stable release, use its release-specific installer, and record the version and installer URL in the private recovery record. Review the installer before running it with root privileges. It installs Docker if needed and initializes the platform.

For reproducibility, use the selected release's installer rather than an unversioned latest installer. Follow the guide's advertise-address instructions if Swarm must use a specific host interface; an advertise address is not a firewall or listener restriction.

1. Access the dashboard over Tailscale and create the owner account.
2. Configure Git access without placing credentials in this repository.
3. Configure an off-server S3 destination and test access. Planned: a new DigitalOcean Spaces bucket in the `personal` doctl context/account, separate from Backrest's bucket. Give Dokploy a key scoped to that bucket (`readwrite`), not a full-access key, and keep a copy of it in the password manager. Create the bucket only when the Dokploy host is ready.
4. Configure Traefik HTTPS using Cloudflare DNS challenges for private application domains. Store the scoped DNS token securely, not in Git.
5. Validate a temporary hostname before changing existing application DNS.
6. Configure a private HTTPS dashboard domain. Only remove direct dashboard port access after verifying the alternate route and recovery access.

Keep the wildcard DNS record pointed at the existing Caddy sidecar during migration. Move individual service records to the new host's Tailscale IP only after each service passes its checks. DNS records must be DNS-only, not Cloudflare-proxied, for this private-address design.

### 4. Verify privacy

From an authorized Tailscale client, verify dashboard and application HTTPS. From a non-Tailscale LAN client and an external connection, verify the dashboard, proxy, and application ports are not accessible through non-Tailscale addresses. Test IPv6 where enabled. Confirm no application publishes unnecessary host ports.

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

1. Run the read-only [host audit](INVENTORY.md#host-audit-checklist-read-only). In particular, confirm whether Backrest covers any named volumes.
2. Confirm the fresh Actual Budget install as the pilot.
3. Choose the Dokploy host (separate VM/host recommended for rehearsal) and the enforceable ingress boundary. Test LAN, WAN, and IPv6 exposure.
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
