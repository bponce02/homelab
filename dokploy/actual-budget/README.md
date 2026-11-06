# Pilot: Actual Budget (fresh install)

Status: prepared, not deployed.

The legacy instance is being redone, not migrated. The Dokploy stack starts with an empty named volume, and you set up the budget again in the new instance. Nothing is copied from `config/volumes/actual-data`. That legacy directory stays untouched and covered by Backrest until you approve its removal.

## Why this service

- Single container, a single data directory, no secrets, and no dependencies on other stacks.
- Exercises the whole target design: Git-defined Compose, a named volume, Traefik HTTPS on a private domain, and S3 volume backup and restore.
- Restoring is easy to verify by hand: open the budget and compare balances and recent transactions.

## Storage

Data lives in the named volume `actual-data`, which Dokploy names `<appName>_actual-data`. There are no bind mounts. Dokploy's volume backups support only named volumes, so this is the layout it expects. The image is pinned to `26.11.0` by digest. Upgrade deliberately by changing the pin in Git, after taking a backup.

## Before you start

- [ ] Dokploy host bootstrapped and its privacy checks passed ([guide](../README.md#manual-bootstrap)).
- [ ] S3 destination configured in Dokploy.
- [ ] Hostname decided. While legacy Actual still runs, use a temporary name such as `actual-pilot.develium.dev`, with a DNS-only record pointing to the Dokploy host's Tailscale IP. Leave `actual.develium.dev` and the wildcard alone.

## 1. Deploy

1. In Dokploy, create a Compose service from this repository, path `dokploy/actual-budget/compose.yaml`.
2. Domain: the hostname → service `actual_server`, port `5006`, HTTPS with the Cloudflare DNS resolver.
3. Deploy. Record the **app name** and confirm that `docker volume ls` shows `<appName>_actual-data`.
4. Open it from a Tailscale client, set the server password, and create the budget the way you want it.
5. Run the privacy checks against the hostname from a non-Tailscale client.

## 2. Prove backup and restore

Do this before you rely on the instance. Use a small amount of real or test data, so the restore result can be checked.

1. Add a volume backup for `<appName>_actual-data` to S3, with **stop container** enabled. Run it once manually and confirm the object exists in S3. Then set the schedule.
2. Restore that backup into a **new** volume name, such as `actual-restore-test`. Don't remove the live volume to satisfy Dokploy's "target must not exist" rule.
3. Start a throwaway container on the restored volume, with no domain and no published port:
   `docker run --rm -d --name actual-restore-check -v actual-restore-test:/data docker.io/actualbudget/actual-server:26.11.0`
   Check that the files and ownership match and that the healthcheck passes. Then remove the container and the test volume.
4. For a full check, restore into the real volume name on a rehearsal stack or a replacement host. Then open the budget through the UI.
5. Record the date, backup object, steps, and any surprises in the private recovery record. Update [the guide](../README.md) if the steps differed.

## 3. Take over `actual.develium.dev` (needs separate confirmation)

1. Stop legacy Actual. Stop it, but don't remove it, and don't touch its data.
2. In Dokploy, change the domain to `actual.develium.dev`. Add a DNS-only `actual` A record pointing to the Dokploy host's Tailscale IP. The specific record overrides the wildcard, which keeps pointing at Caddy.
3. Point any Actual clients at the new server.
4. Leave the Caddy `@actual` route and the legacy Compose file in place until you're satisfied.

## Rollback

- Delete the `actual` A record, so the wildcard routes back to Caddy, and start legacy Actual. It's exactly as you left it.
- Anything entered only in the new instance stays in its volume and S3 backups. Export it from the new instance's UI if you need it elsewhere.

## Afterwards

Remove the legacy Actual Compose service and Caddy route only as a separate, confirmed change. Archive `config/volumes/actual-data` before any deletion is approved; the inventory lists it as retired-service data.
