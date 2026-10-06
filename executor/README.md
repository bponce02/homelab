# Executor.sh

The existing self-hosted instance remains at https://executor.develium.dev. Its account, integrations, data volume, and settings are preserved.

LibreChat now has an `executor` MCP entry using `https://executor.develium.dev/mcp` with OAuth. Enable **executor** in **MCP Servers**, then use its Connect/Authorize action and approve access in your existing Executor account. For agents with a fixed tool list, grant the Executor tools explicitly. The instance advertises OAuth discovery, dynamic client registration, PKCE S256, and refresh tokens; LibreChat manages the authorization flow.

The saved `executor-local.env` and `executor-openwebui.env` tokens both returned HTTP 401 and are not used. Retired bootstrap credentials are not used, and no account is replaced or recreated. A single-user LibreChat deployment still requires the owner's one-time Executor OAuth consent; it does not require copying an API key.

Live verification through LibreChat's authenticated reinitialize endpoint returned `oauthRequired: true` and “ready for OAuth authentication.” The temporary verification user's pending flow was cancelled and the account deleted; the real owner must still authorize their own connection.

No arbitrary code or external integration action is executed as a connection test. Executor tool discovery/execution becomes available only after successful owner consent. Its existing private-network restrictions remain unchanged.
