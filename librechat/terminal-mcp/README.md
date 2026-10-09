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

## Rollout

The fix is not deployed yet. After approval and an idle check, back up the current adapter source/image and private Compose files, build this Dockerfile into a distinct image tag, update only the existing `open-terminal-mcp` service's image, and recreate that service with `--no-deps --no-build`. Preserve its existing environment, network and endpoint. Do not recreate LibreChat, Open Terminal, Mongo or terminal volumes, or rewrite the full live Compose file from the repository's pending MCP-only deployment layout. Verify MCP reconnect and both image reads through General afterward. Rollback is the prior adapter image/source; no filesystem/database restore is required.
