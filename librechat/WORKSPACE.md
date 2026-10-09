# Workspace side panel rollout

The LibreChat fork's `feat/open-terminal-workspace` branch adds the terminal and filesystem sidebar for the existing owner. It is deployed at https://librechat.develium.dev using `local/librechat-homelab:361f0ecdc`. The owner requested a direct rollout without an isolated preflight; config/image backups and idle checks were retained.

The panel requires Open Terminal's file REST routes and `/api/terminals` REST/WebSocket APIs. The repository's `llm/open-terminal` image is configured for native MCP-only mode; that mode cannot serve the panel. Production was confirmed to run upstream `0.14.0` in `run` mode with a separate MCP adapter, and its existing REST/WS service was preserved. Before future changes: do not deploy the MCP-only image as part of this feature.

The deployed policy configures only LibreChat:

```yaml
workspace:
  enabled: true
  ownerId: 'YOUR_EXISTING_USER_ID'
  baseUrl: http://open-terminal:8000
  rootPath: /home/user
```

Set `ownerId` directly to your existing user ID; the field does not interpolate environment variables. Reuse the existing server-side `OPEN_TERMINAL_API_KEY`; do not expose or rotate it. Keep the terminal volume and other containers unchanged. Check that generation jobs and dedicated Workspace shells are idle, back up configs/image identities/Mongo, then recreate only LibreChat. The live native PTY and file operations passed.

Files persist; the UI shell ends on close/logout/reload or a mobile/desktop layout change. The browsing root is not a symlink jail. The panel shares files with agent tools, not their conversation-scoped interactive shell. File version checks are best-effort, not atomic across separate agent writes.

Full implementation, limits, verification and rollback instructions: sibling LibreChat repository `docs/workspace.md`. Only LibreChat's image and the added workspace YAML block changed. Native PTY, text editing and upload/download checks passed; temporary files/shells were removed. The 33 owner chats, 515 messages and General's full configuration (82 tools) were unchanged. Private rollback copies are under `/home/melissa/.local/state/librechat-fork/rollback-workspace-361f0ecdc/`; the prior `48f12a8f2` image remains available. No credential or unrelated service was changed. The full release record is LibreChat `docs/workspace-release.md`; remote CI/review has not been checked.
