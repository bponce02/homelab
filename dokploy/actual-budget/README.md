# Actual Budget on Dokploy

**Status: live on Dokploy since 2026-11-07.**

| | |
| --- | --- |
| Dokploy service | Project `Homelab` → `production` → Compose `actual-budget` (composeId `BhuwoRiVOmXH1w6jOh4TN`, app name `actual-budget-kbggec`) |
| Source | `https://github.com/bponce02/homelab.git`, branch `docs/dokploy-migration`, `./dokploy/actual-budget/compose.yaml`; auto-deploy off |
| Domain | `actual.develium.dev` → `actual_server:5006`, HTTPS (`letsencrypt`); DNS-only A record → `100.126.9.60` |
| Volume | `actual-budget-kbggec_actual-data` (copied from the legacy folder; 4 files verified by checksum) |
| Backup | Volume backup `actual-data daily` to `develium-dokploy-backups`: daily `0 8 * * *` (UTC), keep 14, container stopped during the backup. First run 2026-11-07: archive contains `account.sqlite`, the budget `group-*.sqlite` and its blob |
| Legacy | `actual-budget-actual_server-1` stopped, not removed; `config/volumes/actual-data` untouched. Legacy `actual_mcp` is still running but has no server. The Caddy `@actual` route is unused because the specific DNS record overrides the wildcard |

Restore tested 2026-11-07: Dokploy restored the S3 archive into a new volume, the databases passed integrity checks, and a throwaway instance booted with the existing account. The legacy container and Caddy `@actual` route can now be removed, with your confirmation.

Moved from the legacy Compose stack (`actual-budget/docker-compose.yml`, Actual 26.7.0) with its existing data. Dokploy runs `26.11.0`. Actual migrates the data forward on first start, so this is a one-way upgrade. The legacy data directory is never modified.

- Compose: [`compose.yaml`](compose.yaml): named volume `actual-data`, no host ports, `dokploy-network`.
- Domain: `actual.develium.dev`, set in Dokploy (service `actual_server`, port `5006`, HTTPS, resolver `letsencrypt`).
- Data: Docker volume `<appName>_actual-data`, copied from `config/volumes/actual-data` on the legacy host.
- Not moved: the legacy `actual_mcp` container. It stops working when legacy Actual is stopped. Deferred.

## Migration steps

1. Create the Compose service in Dokploy from this repository (`dokploy/actual-budget/compose.yaml`) and record its app name.
2. Stop legacy Actual: `docker compose -f actual-budget/docker-compose.yml stop` in `/home/melissa/homelab`.
3. Copy the data into the new volume before the first deploy:
   ```bash
   sudo docker volume create <appName>_actual-data
   sudo docker run --rm -v /home/melissa/homelab/config/volumes/actual-data:/from:ro \
     -v <appName>_actual-data:/to alpine cp -a /from/. /to/
   ```
4. Deploy. Verify the budget opens on a temporary hostname.
5. Point `actual.develium.dev` at Dokploy: a DNS-only A record → `100.126.9.60`. The wildcard stays on Caddy.
6. Configure a scheduled volume backup to the S3 destination, with the container stopped during backup. Run it once.

## Rollback

Delete the `actual` A record (the name falls back to the wildcard and Caddy), stop the Dokploy service, and start legacy Actual. Changes made on the Dokploy instance after the move are not in the legacy data. Export the budget first if they matter.
