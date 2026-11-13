#!/usr/bin/env bash
# Runs the seed then every live walk in dependency order against a running stack, printing each
# walk's result and a total. Stops and restarts narration around walk-catalog.sh (the only walk
# that needs it stopped) and leaves the stack as it found it.
#
# Usage: pnpm walks (or services/gateway/scripts/walks.sh directly)
#   Needs the stack already up (identity, catalog, narration, billing, gateway, and the docker
#   compose infra) and SEED_ACCOUNT_PASSWORD set in services/identity/.env. Set BILLING_STOP and
#   BILLING_START to also exercise walk-erasure.sh's step 8 (billing unreachable).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
scripts="$repo_root/services/gateway/scripts"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$repo_root"

NARRATION_OPS=${NARRATION_OPS:-http://localhost:3103}
narration_port=${NARRATION_OPS##*:}

echo '== seeding =='
pnpm seed:dev

# Every walk's pass/fail, one per line — `verify:spine` reads this to know whether a check it
# couldn't run for itself (e.g. `narration:task:progress`, when the create-then-pause race loses)
# was still proven, by a walk, in this same run.
mkdir -p "$repo_root/.cache"
results_file="$repo_root/.cache/walks-results.txt"
: >"$results_file"

results=()
total=0
failed=0

# run_walk NAME COMMAND… — runs one walk, recording its pass/fail for the final report. A failure
# never aborts the run: every other walk still gets its turn.
run_walk() {
  local name=$1
  shift
  total=$((total + 1))
  echo
  echo "== $name =="
  if "$@"; then
    results+=("✓ $name")
    echo "$name pass" >>"$results_file"
  else
    results+=("✗ $name")
    failed=$((failed + 1))
    echo "$name fail" >>"$results_file"
  fi
}

# offline — walk-offline.sh's own prerequisite: a map pack built for the area it registers.
offline() {
  pnpm tiles:build --area hcmc-d1-core && "$scripts/walk-offline.sh"
}

# stop_narration / start_narration — narration is stopped only around walk-catalog.sh, which
# plays narration's own part; every other walk expects it running as the operator started it.
stop_narration() {
  local pid
  pid=$(lsof -ti "tcp:$narration_port" 2>/dev/null || true)
  [[ -n $pid ]] || { echo '• narration already stopped'; return; }
  kill "$pid"
  for _ in $(seq 1 50); do
    lsof -ti "tcp:$narration_port" >/dev/null 2>&1 || { echo '✓ narration stopped'; return; }
    sleep 0.2
  done
  echo 'narration did not stop in 10 s' >&2
}

# The built dist, like every walk's own start_narration — `nest start --watch`'s cold compile
# takes longer than a durable's quiet period is worth waiting twice for.
start_narration() {
  (cd "$repo_root/services/narration" && exec node . >>"$work/narration.log" 2>&1) &
  for _ in $(seq 1 100); do
    curl -sS -o /dev/null "$NARRATION_OPS/health/ready" 2>/dev/null && { echo '✓ narration ready'; return; }
    sleep 0.2
  done
  tail -20 "$work/narration.log"
  echo 'narration did not become ready again' >&2
}

run_walk 'admin' "$scripts/walk-admin.sh"
run_walk 'sessions' "$scripts/walk-sessions.sh"
run_walk 'email' "$scripts/walk-email.sh"
run_walk 'owner-registration' "$scripts/walk-owner-registration.sh"
run_walk 'recovery' "$scripts/walk-recovery.sh"
run_walk 'billing' "$scripts/walk-billing.sh"
run_walk 'taxonomy' "$scripts/walk-taxonomy.sh"
run_walk 'owner-venues' "$scripts/walk-owner-venues.sh"
run_walk 'offline' offline
run_walk 'notifications' "$scripts/walk-notifications.sh"
run_walk 'erasure' "$scripts/walk-erasure.sh"

stop_narration
run_walk 'catalog' "$scripts/walk-catalog.sh"
start_narration

# Each of these three starts and stops its own narration instance (with fake providers), but only
# by a PID it started itself — a host instance already running (as every one of these three needs
# stopped first, by their own header) is invisible to that tracking, so its restart silently loses
# to a port conflict and the walk's own health check finds the old process still answering. Stop
# it by port first, the same way as for walk-catalog.sh, and restore it once after the last one.
stop_narration
run_walk 'hotset' "$scripts/walk-hotset.sh"
run_walk 'narration' "$scripts/walk-narration.sh"
run_walk 'pronunciation' "$scripts/walk-pronunciation.sh"
start_narration

echo
printf '%s\n' "${results[@]}"
echo
echo "$((total - failed))/$total walks passed"
[[ $failed -eq 0 ]]
