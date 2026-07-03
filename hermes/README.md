# Hermes Agent

[Hermes Agent](https://github.com/NousResearch/hermes-agent) ("the agent that
grows with you", by Nous Research) running as a **native CLI install — no
Docker**. Unlike every other service in this repo, there is no
`docker-compose.yml`; Hermes installs itself onto the host with `uv`.

## What's version controlled here

Only the **install method and the pinned version** (`setup.sh`). The actual
code, config, sessions, and logs live in `$HERMES_HOME` (default `~/.hermes`)
and are **not** in this repo — that keeps secrets (API keys) out of git.

## Install / update

```bash
cd hermes
./setup.sh
```

This pins Hermes to the commit in `setup.sh`. To move to a newer version, bump
`HERMES_COMMIT` in `setup.sh`, commit it, and re-run — that's the reproducible,
version-controlled upgrade path.

## Requirements

The installer pulls in what it needs (`uv`, Python 3.11, Node 22, optional
Playwright/ripgrep/ffmpeg). To skip the browser tooling:

```bash
./setup.sh --skip-browser
```

## Config (not yet tracked)

Hermes config lives at `~/.hermes/config.toml`. It contains API keys, so it's
intentionally left out of git for now. If you want it tracked, the clean
pattern (same as `komodo/.env`) is to keep the real file under
`config/env/hermes/` (gitignored) and symlink it into place — ask and I'll
wire that up.
