# CLIProxyAPI

- Management UI: https://cliproxy.develium.dev/management.html
- OpenAI-compatible base URL: https://cliproxy.develium.dev/v1
- Internal base URL for containers on `proxy`: http://cliproxyapi:8317/v1

CLIProxyAPI v8.0.16 is pinned by image digest. Management Center v1.25.3 is downloaded with a verified SHA256 and automatic panel updates disabled. Caddy serves HTTPS through its Tailscale sidecar; the proxy publishes no host ports. Management access is enabled for Caddy but still requires its own key. The service runs as UID/GID 1000 without Linux capabilities or host control mounts.

## Setup

Run as the host's UID 1000 user, from the repository root:

```bash
python3 cliproxyapi/setup.py
sudo docker compose -f cliproxyapi/docker-compose.yml up -d
```

The setup preserves existing credentials and configuration. Live settings live in `config/env/cliproxyapi/config.yaml`, not the committed example. The management UI can edit that writable configuration; CLIProxyAPI hashes its management key on startup. Back up the private configuration and `config/volumes/cliproxyapi/` securely. OAuth credentials under `auth/` are account secrets.

## Management login

Connect to Tailscale and open the management UI. Its URL is detected automatically. On the homelab host, retrieve the generated management key:

```bash
cd /home/melissa/homelab
python3 -c 'import json; print(json.load(open("config/env/cliproxyapi/credentials.json"))["management_key"])'
```

Paste that key into **Management Key**. Keep it out of chats and screenshots. Avoid **Remember password** on shared browsers; the management panel's stored key is recoverable browser data. The management key grants full control of configured provider accounts, not just inference access.

`credentials.json` is the initial secret record. If you rotate keys in the UI, update or securely replace that record as well. The `client_key` field is a separate inference key; it must not be used to sign into the management UI. Secret directories and runtime files are gitignored; newly generated credentials are mode 600.

## Connect a Codex subscription

1. Open **OAuth Login → Codex OAuth → Start Codex Login**.
2. Open the authorization link and sign in to your own ChatGPT account.
3. If the browser redirects to an unreachable `http://localhost:1455/auth/callback?...`, copy that complete address into the management panel's **Callback URL** field and select **Submit Callback URL**. Do not paste it into chat; it contains a temporary authorization code.
4. Wait for authentication to succeed, then inspect **Auth Files** and **Quota Management**.

No OAuth callback ports are published. The UI's manual callback submission supports login from a different computer. A device-code CLI flow is also available:

```bash
sudo docker compose -f cliproxyapi/docker-compose.yml exec cliproxyapi \
  ./CLIProxyAPI -config /etc/cliproxyapi/config.yaml -codex-device-login
```

This is a third-party subscription integration, not an OpenAI API billing key. Subscription quotas and applicable provider terms still apply. Account login and actual inference must be tested after the owner completes OAuth.

## Chat clients and isolation

LibreChat is not automatically reconfigured. After OAuth, use the internal base URL and the generated client key when deliberately adding an endpoint. Confirm model IDs from the authenticated `/v1/models` response; there are no models until upstream credentials are configured.

This deployment is one administrative/credential pool, **not a multi-tenant service**. Different client keys alone do not isolate upstream subscriptions. Do not add other people's accounts expecting tenant isolation; use separate instances and private storage plus per-user client permissions for that.

Usage aggregation is enabled, but the default statistics are in memory and are not an authoritative billing ledger. Request-body logging is disabled. Error logs may still contain sensitive request information; access and backups must remain private.

## Upgrade

Update the Compose image tag/digest and the setup script's panel release/checksum deliberately. To replace the installed panel, stop the service, securely remove only `config/volumes/cliproxyapi/static/management.html`, rerun setup, and start it again. Preserve the live configuration and OAuth auth directory. Do not overwrite the live configuration with the example during upgrades.
