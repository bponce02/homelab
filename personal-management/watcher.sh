#!/bin/bash
# Deploy personal-management when its GitHub main branch gets a new commit.
# Runs as a Dokploy "dokploy-server" schedule (inside the Dokploy container).
set -euo pipefail

ENV_FILE=/etc/dokploy/compose/personal-management-ppbblm/code/personal-management/.env
STATE=/etc/dokploy/schedules/pm-watcher/last-commit
HOOK=http://127.0.0.1:3000/api/deploy/compose/__REFRESH_TOKEN__

TOKEN=$(grep -m1 '^GIT_AUTH_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
TOKEN=${TOKEN#\"}; TOKEN=${TOKEN%\"}  # Dokploy writes values in double quotes
[ -n "$TOKEN" ] || { echo "GIT_AUTH_TOKEN not found in $ENV_FILE"; exit 1; }
AUTH=$(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)

SHA=$(git -c credential.helper= -c http.extraHeader="Authorization: Basic $AUTH" \
  ls-remote https://github.com/bponce02/personal-management.git refs/heads/main | cut -f1)
[ -n "$SHA" ] || { echo "Could not read personal-management main"; exit 1; }

LAST=$(cat "$STATE" 2>/dev/null || true)
if [ -z "$LAST" ]; then
  echo "$SHA" > "$STATE"
  echo "Recorded $SHA (first run, no deploy)"
  exit 0
fi
if [ "$SHA" = "$LAST" ]; then
  echo "No change ($SHA)"
  exit 0
fi

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOOK" \
  -H 'Content-Type: application/json' -H 'X-GitHub-Event: push' \
  -d "{\"ref\":\"refs/heads/main\",\"after\":\"$SHA\",\"head_commit\":{\"id\":\"$SHA\",\"message\":\"personal-management $SHA\"},\"commits\":[]}")
if [ "$CODE" = 200 ]; then
  echo "$SHA" > "$STATE"
  echo "Deploy triggered for $SHA (was $LAST)"
else
  echo "Deploy webhook returned HTTP $CODE for $SHA"
  exit 1
fi
