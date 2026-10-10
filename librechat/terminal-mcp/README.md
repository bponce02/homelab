# Open Terminal REST-to-MCP adapter

This adapter accompanies Open Terminal `0.14.0` in `run` mode. Keep REST/WebSocket mode for the LibreChat Workspace panel; this is not the pending MCP-only terminal migration in `llm/`.

The adapter uses the existing FastMCP `2.14.5`, Open Terminal key, service URL, `X-User-Id: librechat` header and tool names. It replaces only the auto-generated `read_file` handler. No extra account or tool permission is introduced.

## Image-reader bug

Open Terminal correctly serves JPEG and PNG bytes from `/files/read`. Its OpenAPI schema declares only `application/json`, and FastMCP's generated handler tries `response.json()` before falling back to text. Binary image bytes raise `UnicodeDecodeError`, which that handler does not catch. Catching the decoding error alone would still produce text, not an image.

The explicit reader checks the actual response MIME type before decoding. Images become MCP `ImageContent` blocks containing their original binary bytes encoded as base64 and the upstream MIME type. Text/JSON results and optional 1-indexed line ranges are retained. Requests retain the existing server credentials, with sanitized reader errors and a streamed size limit (`READ_FILE_MAX_BYTES`, default 10 MiB). The model/provider may impose smaller limits or narrower image-format support.

## Verification

- Five Python tests passed using the real FastMCP client/server and mocked HTTP only: PNG/JPEG/WebP image serialization, text/line ranges, size limits and sanitized failures.
- A disposable, CPU/memory-limited adapter process read the two reported JPEG/PNG files against the existing REST server, without replacing the production adapter or modifying either file.
- LibreChat's real MCP parser and agent artifact projection passed image-boundary regressions: image bytes remain `image_url` blocks rather than serialized tool text. The focused parser suites passed 162 tests.
- The existing Codex connector/model separately inspected both actual MCP image payloads through the agent artifact projection and correctly identified the Tetris menu, green PLAY button and LEVEL: 1. These were direct verification requests, not new persisted chats or changes to General.
- Camofox `screenshot` returned an actual MCP PNG image block for a disposable public-page tab, and the model interpreted it visually. That test did not reproduce a screenshot serialization bug. The tab was closed; localhost/private-network blocking was not changed or bypassed.

The Python tests used the existing adapter image as a test runtime, with no global installation:

```sh
docker run --rm --network none --cpus 1 --memory 512m --memory-swap 512m \
  --pids-limit 128 --ulimit core=0 -v "$PWD/librechat/terminal-mcp:/app:ro" \
  --entrypoint python local/librechat-terminal-mcp:fastmcp-2.14.5 \
  -m unittest -v test_server
```

## LibreChat custom-provider bridge

The binary reader fix alone was not enough for General: LibreChat's tool loader/invocation used the endpoint label `Codex Subscription`, triggering its unknown-provider text fallback. LibreChat patches `25ece7f71` and `7a7c003f1` now resolve configured endpoint names to the actual backing provider and preserve that provider at invocation. Current app image is `local/librechat-homelab:7a7c003f1`; the MCP adapter remains `59cbb67`.

A real General chat now reads `frame-23.jpg` without an attachment or separate vision model and correctly identifies the active red Z in the upper-left (columns 2–4, top two rows), plus the purple T above the orange L. Source: https://librechat.develium.dev/c/1b2dc129-7750-5536-9ad7-7cdd95000e73. The frame was independently viewed and agrees. The earlier failed test chat was deleted; the successful verification chat remains. Source-boundary tests: 163 API tests and 147 legacy MCP/loader tests, API typecheck/build and ESLint passed.

The backend-only image layers validated compiled API output and changed CJS adapters onto `361f0ecdc`, using `../Dockerfile.mcp-provider`. No dependency or frontend change is carried. Build with the host-local legacy Docker builder capped at one CPU/512 MiB; a containerized BuildKit builder cannot see the host-local base tag. Copy only the declared build-context files from the LibreChat checkout, not credentials. Private app rollback baseline is `/home/melissa/.local/state/librechat-fork/rollback-mcp-provider-25ece7f71/`. Only LibreChat was recreated after idle checks; no terminal service/file or selected tool was changed. Remote CI/review is unverified.

## Deployment

Deployed as `local/librechat-terminal-mcp:59cbb67` after the owner's approval and an idle check. Only Compose service `terminal-mcp` (container `open-terminal-mcp`) was recreated; its existing environment, network and endpoint were preserved. LibreChat's existing owner connection was reinitialized successfully without OAuth or an application restart. Both reported files returned correct image blocks from the deployed HTTP MCP endpoint, and the existing Codex model visually identified each as the Tetris menu. One PNG model-verification request failed transiently; an isolated retry passed. General retained 82 tools. Open Terminal, LibreChat, Mongo, connectors and terminal volumes were not recreated.

Private rollback directory: `/home/melissa/.local/state/librechat-fork/rollback-terminal-images-59cbb67/`, containing prior adapter source, Compose and image identity. The previous `local/librechat-terminal-mcp:fastmcp-2.14.5` image remains available. The build used the existing one-core/6-GiB builder, which was stopped afterward. Temporary key/model-helper files were removed. CI/review remains unverified.

For future rollouts, retain this targeted procedure: back up the current adapter source/image and private Compose files, build a distinct image tag, and recreate only service `terminal-mcp` with `--no-deps --no-build`. Do not rewrite the full live Compose file from the repository's pending MCP-only deployment layout. The optional `../docker-compose.terminal-mcp.yml` pins the deployed image when merged with the existing REST-mode live Compose file; it is not a complete deployment. Rollback is the prior adapter image/source and a reconnection of that MCP server; no filesystem/database restore is required.
