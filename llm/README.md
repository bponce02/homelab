# llm (legacy)

Ollama (local models, `llm/ollama`), Camofox browser and its MCP adapter. LibreChat uses them over the `proxy` and `llm_browser` networks. No host ports are published.

- Camofox secrets: `config/env/llm/camofox.env` (`CAMOFOX_API_KEY`, `CAMOFOX_HTTP_API_KEY`), not committed.
- OpenRouter key for LibreChat: `config/env/openrouter.env`.
- Open Terminal and Open WebUI are retired. Their data is preserved ([README](../README.md#retired-stopped-data-preserved)). The `terminal` network is kept only because LibreChat's legacy Compose file references `llm_terminal`.

This stack moves or changes with the LibreChat rebuild.
