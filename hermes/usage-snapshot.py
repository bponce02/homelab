#!/usr/bin/env python3
"""Snapshot Codex/Claude account-quota windows to JSON for the Hub app.

Runs on the host (systemd user timer) with Hermes' own venv so it can import
``agent.account_usage``, which holds the provider tokens and endpoints. The
Hub container bind-mounts the output read-only; its usage panel just reads
the file instead of asking the agent "/usage" in prose.
"""

import json
import os
import sys
import tempfile

HERMES_SRC = os.path.expanduser("~/.hermes/hermes-agent")
# Inside the app's existing /app/data bind mount, so no compose changes.
OUT_PATH = os.path.expanduser(
    "~/homelab/config/volumes/personal-management/data/usage-snapshot.json"
)

sys.path.insert(0, HERMES_SRC)

from agent.account_usage import fetch_account_usage  # noqa: E402


def window_dict(w):
    return {
        "label": w.label,
        "used_percent": w.used_percent,
        "reset_at": w.reset_at.isoformat() if w.reset_at else None,
        "detail": w.detail,
    }


def snapshot_dict(s):
    if s is None:
        return {"available": False, "error": "no snapshot"}
    return {
        "available": s.available,
        "plan": s.plan,
        "fetched_at": s.fetched_at.isoformat(),
        "windows": [window_dict(w) for w in s.windows],
        "details": list(s.details),
        "error": s.unavailable_reason,
    }


def main():
    from datetime import datetime, timezone

    data = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "codex": snapshot_dict(fetch_account_usage("openai-codex")),
        "claude": snapshot_dict(fetch_account_usage("anthropic")),
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(OUT_PATH))
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, OUT_PATH)
    os.chmod(OUT_PATH, 0o644)
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
