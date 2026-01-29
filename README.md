# Homelab Setup

Self-hosted homelab infrastructure with Docker and Cloudflare Tunnel.

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

### 3. Install Cloudflared

```bash
# Add Cloudflare GPG key
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null

# Add repository to apt sources
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

# Install cloudflared
sudo apt-get update && sudo apt-get install cloudflared
```

### 4. Configure Cloudflared

1. Go to Cloudflare dashboard and create a new tunnel
2. Copy the service install command and run it on your server

### 5. Setup Backrest

1. Paste Backrest config into `config/volumes/backrest/config/config.json` (stored in Bitwarden)

2. Create Docker network:
```bash
sudo docker network create proxy
```

3. Start Backrest:
```bash
sudo docker compose -f backrest/docker-compose.yml up -d
```

4. Open Backrest in browser: `http://SERVER_IP:9898/`

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

## Configure Cloudflare Tunnel

### 1. Clean Up Old Configuration

1. Go to Cloudflare dashboard → DNS
2. Clear all DNS records for your domain
3. Go to Access → Networks → Connectors
4. Delete old tunnels

### 2. Create New Tunnel

1. Create a new tunnel in Cloudflare
2. Click the three dots (⋮) on the tunnel → Configure

### 3. Setup Public Hostname Routes

Add two public hostname routes:

| Subdomain | Service |
|-----------|---------|
| `yourdomain.com` | `http://localhost` |
| `*.yourdomain.com` | `http://localhost` |

### 4. Configure DNS Records

Go back to DNS settings and create CNAME records:
- `@` (root domain) → your tunnel
- `*` (wildcard) → your tunnel

## Start All Services

```bash
# Start all containers
sudo docker compose -f actual-budget/docker-compose.yml up -d
sudo docker compose -f authentik/docker-compose.yml up -d
sudo docker compose -f caddy/docker-compose.yml up -d
sudo docker compose -f dozzle/docker-compose.yml up -d
sudo docker compose -f homepage/docker-compose.yml up -d
sudo docker compose -f llm/docker-compose.yml up -d
sudo docker compose -f n8n/docker-compose.yml up -d
sudo docker compose -f nextcloud/docker-compose.yml up -d
sudo docker compose -f paperless/docker-compose.yml up -d
sudo docker compose -f stirlingpdf/docker-compose.yml up -d
sudo docker compose -f vikunja/docker-compose.yml up -d
```

## Done! 🎉

Your homelab should now be fully operational and accessible through your Cloudflare tunnel.
