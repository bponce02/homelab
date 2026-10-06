# LibreChat history tools

Read-only MCP tools for the existing LibreChat database:

- `list_chats`: recent saved conversations, with pagination and optional archives.
- `search_chats`: literal-phrase search over titles and visible message text.
- `read_chat`: a bounded page of messages from a selected conversation, with source links and branch parent IDs.

Enable **chat-history** under **MCP Servers** for the chat/agent that should use it. It does not automatically inject every prior conversation into prompts. Retrieved chat text is historical data, not instructions. A General agent with a fixed tool list must be granted these tools in its agent configuration or through the chat's MCP selector.

## Boundaries

The MCP bearer key authenticates LibreChat as a trusted caller. LibreChat injects the current user ID through `X-LibreChat-User-Id: "{{LIBRECHAT_USER_ID}}"`; tool arguments cannot choose another user. Missing/malformed identity fails closed. Every conversation and message query is owner-scoped, and reads recheck conversation ownership. Archived chats are opt-in for listing/search. Subagent threads, tenant-scoped records, temporary conversations, orphaned messages, private reasoning, attachments, tool payloads, and server-private metadata are excluded.

This is a standalone, non-tenant LibreChat deployment. Do not reuse this adapter unchanged in a multi-tenant installation. A holder of its bearer key can impersonate a user header, so never give the server key to end users or expose it as a model argument.

Only `find`/`find_one` are used; there are no mutation, arbitrary query, or aggregation tools. The existing MongoDB runs without database authentication on its internal Docker network, so **read-only is enforced by the adapter's API/code, not a MongoDB read-only role**. The service has no host ports, host mounts, or public route and joins only LibreChat's internal database network. No MongoDB authentication migration or history synchronization is performed.

Search is literal and bounded: at most 100 recent matching message candidates, 20 returned conversations, and server-side query deadlines. It is not semantic or exhaustive search. `read_chat` caps each message at 8,000 characters and a page at 32,000 characters; truncation and pagination are explicit. Stored alternative branches may appear; use the returned parent IDs to distinguish them.

## Configuration

`config/env/librechat/history-mcp.env` contains a separate random `HISTORY_MCP_API_KEY` (mode 0600, gitignored). The same file is loaded by LibreChat and the history service. The live database URI remains internal: `mongodb://mongodb:27017/LibreChat`.

Compose service: `history-mcp`, container `librechat-history-mcp`, endpoint `http://librechat-history-mcp:8000/mcp`. `/health` is liveness only; `/mcp` requires the bearer key. Client timeouts, query deadlines, output caps, and a small connection pool bound work.

Local synthetic tests:

```bash
uv run --with fastmcp==2.14.5 --with pymongo==4.15.3 --with mongomock==4.3.0 \
  python -m unittest discover -s librechat/history-mcp -v
```

Tests cover owner isolation, invalid identity, literal search, private-content exclusion, archived/hidden/tenant/orphaned data, output limits, tool discovery, and unchanged records.
