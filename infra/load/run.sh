#!/usr/bin/env bash
# pnpm load [-- --smoke] — the crowd (README.md) against the local Compose stack: the load
# override on the gateway, k6 from its image on the stack's network, the summary in results/.
# LOAD_STACK=screens runs it against the screens' disposable stack (apps/console/e2e/screens/stack.sh)
# instead of the developer's.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"
K6_IMAGE=grafana/k6:2.3.0

smoke=0
for arg in "$@"; do [ "$arg" = --smoke ] && smoke=1; done

if [ "${LOAD_STACK:-}" = screens ]; then
  normal=(docker compose -p wayfare-screens -f compose.yaml -f infra/docker/compose.screens.yaml)
  network=wayfare-screens_default
else
  normal=(docker compose -f compose.yaml)
  network=wayfare_default
fi
loaded=("${normal[@]}" -f infra/docker/compose.load.yaml)

# The policy version the installs accept: contracts' own, so it never drifts.
policy=$(node -p "require('./packages/contracts').LEGAL_DOCUMENT_VERSIONS.PRIVACY_POLICY")

restore() { "${normal[@]}" --profile apps up -d --no-deps --wait gateway >/dev/null; }
"${loaded[@]}" --profile apps up -d --no-deps --wait gateway >/dev/null
trap restore EXIT

mkdir -p infra/load/results
docker run --rm --network "$network" --user "$(id -u):$(id -g)" \
  -v "$repo/infra/load:/load" -w /load \
  -e K6_NO_USAGE_REPORT=true -e SMOKE="$smoke" -e PRIVACY_POLICY_VERSION="$policy" \
  -e BASE_URL=http://gateway:3000 \
  "$K6_IMAGE" run --quiet /load/crowd.js
