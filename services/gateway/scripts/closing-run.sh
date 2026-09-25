#!/usr/bin/env bash
# pnpm closing-run — the quiet run that closes Phase 2: builds once, starts the five services from
# their built dist (`node .`) one at a time, waiting for each one's `/health/ready` before the
# next, records `free -m` before the first start and after the last check, runs the seed, the
# walks and `verify:spine` on that stack, writes everything to a timestamped log under `.cache/`,
# and stops what it started.
#
# Usage: pnpm closing-run
#   Run after `docker compose up -d --wait`. Close the editor's language servers first — this
#   script cannot, and they were a large share of the memory the reaper reclaimed last time.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

mkdir -p .cache
log=".cache/closing-run-$(date +%Y%m%d-%H%M%S).log"
: >"$log"

services=(identity catalog narration billing gateway)
declare -A ops_url=(
  [identity]=http://localhost:3101
  [catalog]=http://localhost:3102
  [narration]=http://localhost:3103
  [billing]=http://localhost:3104
  [gateway]=http://localhost:13000
)

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "✗ $*" | tee -a "$log" >&2
  exit 1
}

echo '== build ==' | tee -a "$log"
pnpm build 2>&1 | tee -a "$log" || fail 'build failed'

echo | tee -a "$log"
echo '== free -m, before ==' | tee -a "$log"
free -m | tee -a "$log"

for service in "${services[@]}"; do
  echo | tee -a "$log"
  echo "== starting $service ==" | tee -a "$log"
  (cd "$repo_root/services/$service" && exec node .) >>"$log" 2>&1 &
  pids+=("$!")
  ready=0
  for _ in $(seq 1 100); do
    curl -sS -o /dev/null "${ops_url[$service]}/health/ready" 2>/dev/null && { ready=1; break; }
    sleep 0.2
  done
  [[ $ready == 1 ]] || fail "$service did not become ready"
  echo "✓ $service ready" | tee -a "$log"
done

echo | tee -a "$log"
echo '== seeding ==' | tee -a "$log"
pnpm seed:dev 2>&1 | tee -a "$log" || fail 'seeding failed'

echo | tee -a "$log"
echo '== walks ==' | tee -a "$log"
pnpm walks 2>&1 | tee -a "$log"
walks_status=${PIPESTATUS[0]}

echo | tee -a "$log"
echo '== verify:spine ==' | tee -a "$log"
pnpm verify:spine 2>&1 | tee -a "$log"
spine_status=${PIPESTATUS[0]}

echo | tee -a "$log"
echo '== free -m, after ==' | tee -a "$log"
free -m | tee -a "$log"

echo | tee -a "$log"
echo "log: $log" | tee -a "$log"
[[ $walks_status == 0 && $spine_status == 0 ]]
