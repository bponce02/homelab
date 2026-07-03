#!/usr/bin/env bash
# ============================================================================
# Hermes Agent — reproducible, non-Docker install (Nous Research)
# ============================================================================
# Hermes is a CLI agent, not a container. The upstream installer clones
# NousResearch/hermes-agent into $HERMES_HOME (default ~/.hermes/hermes-agent),
# builds a uv venv, and puts a `hermes` command on PATH.
#
# This wrapper pins the install to a specific upstream commit, so the version
# is captured in git — `git pull` + re-run gives a deterministic result rather
# than whatever is on upstream `main` today.
#
#   ./setup.sh              # install or update to the pinned commit below
#   ./setup.sh --skip-setup # ... without the interactive setup wizard
#
# Code + config + sessions live in $HERMES_HOME, NOT in this repo. Only the
# pinned version and the install method are version controlled here.
# ============================================================================
set -euo pipefail

# The one version-controlled knob. Bump this to move Hermes forward, commit it.
# Current: NousResearch/hermes-agent @ main on 2026-06-27
HERMES_COMMIT="20c83af66485fc1cc546bae4477ddbbc55bd9d0b"

echo "→ Installing Hermes Agent pinned to ${HERMES_COMMIT}"
curl -fsSL https://hermes-agent.nousresearch.com/install.sh \
  | bash -s -- --commit "$HERMES_COMMIT" "$@"
