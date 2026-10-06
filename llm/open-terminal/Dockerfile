FROM ghcr.io/open-webui/open-terminal:0.14.0
USER root
RUN pip install --no-cache-dir fastmcp==4.0.11 \
    && python -c "import importlib.metadata; assert importlib.metadata.version('open-terminal') == '0.14.0'" \
    && OPEN_TERMINAL_API_KEY=build-only-import-check python -c "from open_terminal.mcp_server import mcp"
USER user
CMD ["mcp", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8000"]
