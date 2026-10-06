# Chat services

LibreChat: https://librechat.develium.dev

LibreChat offers Ollama's local models and OpenRouter's hosted models through the Tailscale-connected Caddy; no host ports are published. The `llm` stack retains Ollama, Open Terminal, and Camofox as dependencies for LibreChat.

## Open WebUI retirement (pending deployment)

Open WebUI's Compose service, `llm.develium.dev` Caddy route, and its Camofox connection helper have been removed from the repo. No live container or data has been changed for this retirement.

When explicitly deploying this change, remove only the old Open WebUI container and reload the validated Caddy configuration:

```bash
docker stop open-webui
docker rm open-webui
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Preserve `config/volumes/llm/openwebui/` and `config/env/llm/openwebui-terminal.env` for recovery. Do not tear down the entire `llm` stack or delete `llm_terminal-home`: LibreChat still uses its services, networks, and terminal workspace. Open Terminal's image is published under `ghcr.io/open-webui`, but it is a standalone service and does not require the Open WebUI application.

## OpenRouter

The API key is stored on the host in `config/env/openrouter.env` as `OPENROUTER_API_KEY`, with file permissions `600`. It is not committed.

LibreChat reads that file through Compose and exposes an **OpenRouter** endpoint. Key rotation requires updating the file and recreating LibreChat.

Select the **OpenRouter** endpoint in LibreChat. Hosted usage is billed to your OpenRouter account, separately from any ChatGPT subscription. Ollama models remain local.

## Open Terminal

The repository now connects LibreChat directly to Open Terminal's native MCP endpoint at `http://open-terminal:8000/mcp` on the separate `llm_terminal` network. The custom `open-terminal-mcp` adapter has been removed from the repo; this migration is not yet deployed.

`llm/open-terminal/Dockerfile` extends Open Terminal 0.14.0 with its optional MCP dependency, pinned to FastMCP 4.0.11. The upstream image installs only the base package, so changing the startup command alone is insufficient. The inherited entrypoint runs `open-terminal mcp --transport streamable-http --host 0.0.0.0 --port 8000`. This is native MCP-only mode, not the previous standalone REST API; direct REST clients must not assume `/execute` or `/openapi.json` remains exposed over HTTP.

Select **open-terminal** in the chat's MCP Servers menu or add its tools in Agent Builder. This provides agent tools, not an embedded interactive terminal UI in LibreChat.

Commands run inside the terminal container, not on the homelab host. Its workspace persists at `/home/user` in the `llm_terminal-home` Docker volume. It has no host directories or Docker socket mounted, and is limited to 2 CPUs and 2 GiB RAM. Users of these tools share the terminal workspace.

`config/env/llm/open-terminal.env` stores the existing `OPEN_TERMINAL_API_KEY`. This file is not committed. Keep it: both the terminal and LibreChat use it for Bearer authentication. No key or workspace migration is needed. Start the `llm` stack before LibreChat so its external terminal and browser networks exist.

### Native MCP migration (deploy only after review)

After preparing the other pending changes, including Stirling PDF's credential file, build/start the terminal and wait for its health check before recreating LibreChat:

```bash
docker compose -f llm/docker-compose.yml up -d --build --wait open-terminal
docker compose -f librechat/docker-compose.yml up -d librechat
```

The services are in different Compose projects, so LibreChat cannot use `depends_on` to wait for the terminal. Its MCP connection retains the server name `open-terminal`. Verify agent tool discovery and a simple command after deployment; review existing agents' selected tools if generated tool schemas differ. Once confirmed, remove only the obsolete adapter container:

```bash
docker stop open-terminal-mcp
docker rm open-terminal-mcp
```

Do not remove `open-terminal`, its `llm_terminal-home` volume, or the `llm_terminal` network. Existing shell processes will end when the terminal is recreated, but workspace files remain.

Local native-MCP smoke test (starts a loopback-only process, uses temporary files, and never contacts the homelab):

```bash
uv run --with 'open-terminal[mcp]==0.14.0' --with fastmcp==4.0.11 \
  python -m unittest discover -s llm/open-terminal -p 'test_*.py' -v
```

This checks missing/invalid key rejection, authenticated tool discovery, and real command/file execution against the pinned upstream packages. The derived Docker image still needs building and a container-level smoke test before deployment.

## Camofox

LibreChat connects to `http://camofox-mcp:8080/mcp` using Bearer authentication. The browser and MCP adapter run in the `llm` stack on the separate `llm_browser` network; neither publishes host ports. Browser navigation to private networks is disabled. No host files or Docker socket are mounted. Browser access is shared by users of these tools; do not treat model-supplied user IDs as an authorization boundary or use this shared browser for sensitive logins.

Images are pinned to `redf0x1/camofox-browser:2.4.7` and `redf0x1/camofox-mcp:1.15.0`. Browser telemetry and automatic MCP profile saving are disabled. The browser image creates an anonymous data volume; a managed persistent profile and secure interactive login viewer have not been configured.

`config/env/llm/camofox.env` holds two independently generated secrets (permissions `600`, never committed):

- `CAMOFOX_API_KEY`: MCP-to-browser authentication.
- `CAMOFOX_HTTP_API_KEY`: LibreChat-to-MCP authentication.

LibreChat reads the key from Compose. After key rotation, recreate Camofox, its MCP adapter, and LibreChat. Select Camofox's tools in a chat or agent and use a tool-capable model.

## Stirling PDF tools (pending deployment)

The repository registers `stirling-pdf` as a LibreChat MCP server. Select it and Open Terminal in an agent after deployment. PDFs are processed from the terminal's shared `/home/user/pdfs` folder, with signed 24-hour download links for outputs. Chat uploads are not automatically copied there. See [setup and limitations](../stirlingpdf/README.md).

## LibreChat

Experimental **Scheduled chats** is enabled through `interface.schedules.use/create`. Open the calendar/clock icon in the left sidebar and click **+** to schedule an agent prompt. The agent's model and supported tools run unattended; hosted model usage is billed normally. No jobs are provisioned by this configuration. The single-container scheduler uses `SCHEDULES_SINGLE_PROCESS=true`; revisit that setting before scaling LibreChat to multiple replicas.

No model-spec preset is configured. Use the **Agents** panel to create assistants with an OpenRouter or Ollama model and select their tools and memory settings. Memory, Open Terminal, and Camofox remain available, but are no longer automatically selected by the former **Homelab Assistant** preset. The standard input controls are no longer hidden. Removing that preset does not delete chats, memories, or agents.

Executor is not included yet: the previously saved API key returned HTTP 401. Obtain a valid key from the current Executor owner before adding the MCP connection and selecting it for an agent.

LibreChat runs with its own MongoDB database and user accounts. Create your account in its web UI. Registration is available only to users who can reach it through Tailscale.

The `Ollama` endpoint discovers the existing local models. Only chat is configured; document RAG and conversation search services are not deployed.

`config/env/librechat/.env` contains generated `CREDS_KEY` (32-byte hex), `CREDS_IV` (16-byte hex), `JWT_SECRET`, and `JWT_REFRESH_SECRET`. Preserve these credentials and `config/volumes/librechat/` when backing up or upgrading.
