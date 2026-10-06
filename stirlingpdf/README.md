# Stirling PDF agent tools

Repository configuration only: deploy explicitly after review. The MCP adapter has not been deployed or tested against the live PDF API.

The existing PDF UI stays at https://pdf.develium.dev. The adapter exposes eight tools: list workspace PDFs, merge, split, rotate, compress, extract text, convert pages to PNG, and OCR. Endpoint shapes were checked against Stirling PDF 2.10.1's `/v1/api-docs`; the existing server image is pinned by digest to avoid an incidental upgrade.

## Prepare credentials and deploy later

On the deployment host, from the repository root, generate the MCP key once:

```bash
mkdir -p config/env/stirlingpdf
(umask 077; set -C; printf 'STIRLING_MCP_API_KEY=%s\n' "$(openssl rand -hex 32)" > config/env/stirlingpdf/mcp.env)
```

The command refuses to overwrite an existing key. This file is gitignored. If Stirling PDF has API authentication enabled, add its existing `STIRLING_API_KEY` to the same file; that key is sent only to Stirling PDF, not included in tool results.

The shared `llm_terminal-home` volume must already exist (start the `llm` stack first). The MCP service runs as UID 1000, matching Open Terminal, without host directories or Docker socket access. After reviewing the changes:

```bash
docker compose -f stirlingpdf/docker-compose.yml up -d --build
docker compose -f librechat/docker-compose.yml up -d librechat
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

No host ports are published. The MCP endpoint is `http://stirling-pdf-mcp:8000/mcp` on the Docker `proxy` network. It requires `Authorization: Bearer <STIRLING_MCP_API_KEY>`.

## LibreChat agents

The repo's LibreChat configuration registers **stirling-pdf**. After deployment, select its tools in the Agent Builder, together with **open-terminal** for file preparation. Existing agents are not silently modified.

1. Use Open Terminal to put PDFs in `/home/user/pdfs/`.
2. Call `list_pdf_files`, then a PDF tool with one of those paths.
3. The result gives an output path in `/home/user/pdfs/results/` and a download URL.

A LibreChat chat attachment is not automatically copied to the terminal. Use Open Terminal's file/command tools to transfer it from an accessible source; LibreChat does not provide Open WebUI's interactive terminal file interface. The tools deliberately reject arbitrary URLs, outside-workspace paths, and chat attachment IDs. PDF inputs are limited to 20 files totaling 50 MiB; each output is limited to 50 MiB. Text extraction includes at most 20,000 characters inline plus the full text download.

OCR requires language data installed in Stirling PDF (`eng` by default). Compression can reduce quality. Merging removes certification signatures; all transformations create new output files and leave originals intact.

## Download links and shared data

Caddy forwards only `/agent-files/*` under the existing PDF hostname to the adapter. Generated links expire after 24 hours and require an HMAC signature as well as Tailscale access. No MCP endpoint is exposed through that route. Anyone with a valid link and network access can download it; there is no per-user authorization. Do not share those links unintentionally.

The workspace is shared by all users of the existing terminal, not isolated by LibreChat account or agent. Avoid sensitive multi-user workflows. Input files and output files remain in the terminal volume until explicitly removed; expiring a link does not delete the file. Clean up `/home/user/pdfs/results/` periodically. Key rotation invalidates all existing download links and requires recreating both the adapter and LibreChat and updating any other MCP clients.

## Local tests

```bash
uv run --with fastmcp==2.14.5 python -m unittest discover -s stirlingpdf/mcp -p 'test_*.py' -v
```

Tests use temporary files and mocked Stirling responses, including multipart contracts, bearer authentication, signed downloads, and workspace boundaries. They do not contact or modify the homelab. Real conversions and agent tool discovery still need a deployment smoke test.
