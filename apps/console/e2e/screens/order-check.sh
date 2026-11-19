#!/usr/bin/env bash
# Conventions §12.8's check that no screens file depends on another: the console's four shards run
# last to first on ONE fresh stack, so a spec that reads what a later file makes, or a later file
# that changes what an earlier one draws, fails in the open. CI runs it once a week (e2e.yml).
#
#   apps/console/e2e/screens/order-check.sh
#
# The console's screens build is started once and reused by every shard (`reuseExistingServer`);
# the stack comes up after the build, so the build's CPU never competes with the setup's calls.
# The first shard snapshots the seed (seed.ts); the others reuse the stack and keep it.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
console="$repo/apps/console"
port=5183
gateway=http://localhost:23000

cd "$console"
fuser -k "$port/tcp" 2>/dev/null || true
env NEXT_DIST_DIR=.next-screens NEXT_PUBLIC_API_ORIGIN="$gateway" GATEWAY_INTERNAL_URL="$gateway" \
  MEDIA_ORIGINS=http://localhost:24443 NEXT_PUBLIC_DEV_TOOLS=1 \
  bash -c "pnpm exec next build && exec pnpm exec next start --port $port" &
server=$!
trap 'kill "$server" 2>/dev/null || true; fuser -k "$port/tcp" 2>/dev/null || true' EXIT
until curl -s -o /dev/null "http://localhost:$port/sign-in"; do
  kill -0 "$server" 2>/dev/null || { echo "the console's build failed" >&2; exit 1; }
  sleep 2
done

"$repo/apps/console/e2e/screens/stack.sh" reset

failed=0
for shard in 4 3 2 1; do
  reuse=1
  [[ "$shard" = 4 ]] && reuse=0
  echo "── shard $shard/4"
  E2E_STACK=screens E2E_SCREENS_REUSE=$reuse E2E_SUITE=screens \
    pnpm exec playwright test --project=screens --retries=0 --shard="$shard/4" \
    --output="test-results/shard-$shard" || failed=1
done
exit "$failed"
