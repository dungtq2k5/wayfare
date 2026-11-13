#!/usr/bin/env bash
# pnpm recover:narration — brings narration back after the local object store lost its files
# (rdm-spec N-3). Not a walk: a runbook you run once, then again to confirm there is nothing left.
#
# Two arms, both through the admin routes (api-endpoints-plan §4.3), as the super admin:
#   1. retry every job in FAILED or PARTIALLY_FAILED — their tasks failed at STORE while the
#      bucket was gone;
#   2. regenerate every live Place whose audio a job already published, because a localization can
#      be READY while its object is gone: its job is COMPLETED, so no retry would touch it. The
#      cache verifies each object now, so a Place whose files are all there is a cache hit and
#      costs nothing.
# Then it polls until every Place of the area is live again, or reports what is left.
#
# Usage: services/gateway/scripts/recover-narration.sh [--no-regenerate] [--timeout <seconds>]
#   Needs the stack running (identity, catalog, narration, gateway) and the media bucket present:
#   `pnpm --filter @wayfare/catalog storage:setup` first if it was just recreated.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

regenerate=1
timeout=300
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-regenerate) regenerate=0; shift ;;
    --timeout) timeout=$2; shift 2 ;;
    *) fail "unknown argument $1" ;;
  esac
done

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
media_base=$(grep -E '^GCS_PUBLIC_BASE_URL=' "$repo_root/services/catalog/.env" | cut -d= -f2-)
# api NAME METHOD PATH [BODY] — an admin call; prints the HTTP status, body in $work/NAME.json.
api() {
  local name=$1 method=$2 path=$3 body=${4:-}
  curl -sS -o "$work/$name.json" -w '%{http_code}' -X "$method" "$BASE$path" "${console[@]}" \
    -b "$(admin)" ${body:+-d "$body"}
}

step '0. sign in as the super admin'
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"

step '1. retry every job that failed'
retried=0
already=0
for status in FAILED PARTIALLY_FAILED; do
  page=1
  while :; do
    [[ $(api jobs GET "/admin/narration/jobs?status=$status&page=$page&pageSize=100") == 200 ]] ||
      fail "listing $status jobs: $(cat "$work/jobs.json")"
    mapfile -t ids < <(jq -r '.data[].id' "$work/jobs.json")
    [[ ${#ids[@]} -gt 0 ]] || break
    for id in "${ids[@]}"; do
      code=$(api retry POST "/admin/narration/jobs/$id/retry-failed")
      case $code in
        200) retried=$((retried + 1)) ;;
        # It left FAILED between the listing and now — someone else, or an earlier run.
        409) already=$((already + 1)) ;;
        *) fail "retrying $id: HTTP $code $(cat "$work/retry.json")" ;;
      esac
    done
    # The listing's own meta, not the last retry's answer.
    [[ $(jq -r '.meta.total > (.meta.page * .meta.pageSize)' "$work/jobs.json") == true ]] || break
    page=$((page + 1))
  done
done
echo "✓ retried $retried job(s)${already:+, $already already active}"

if [[ $regenerate == 1 ]]; then
  step '2. regenerate every live Place that has published audio'
  # The languages whose audio a job wrote: READY (the object may be gone) or FAILED. A Place with
  # none of them has no audio to repair.
  catalog_sql "
    SELECT p.id || ' ' || string_agg(DISTINCT l.lang, ',' ORDER BY l.lang)
    FROM places p JOIN place_localizations l ON l.place_id = p.id
    WHERE p.deleted_at IS NULL AND p.status IN ('PROCESSING', 'ACTIVE')
      AND l.audio_status IN ('READY', 'FAILED')
    GROUP BY p.id" >"$work/targets.txt"
  regenerated=0
  while read -r place_id langs; do
    [[ -n $place_id ]] || continue
    request=$(jq -nc --arg id "$place_id" --arg langs "$langs" \
      '{targetType: "PLACE", targetId: $id, langs: ($langs | split(",")), includeAudio: true}')
    code=$(api regenerate POST '/admin/narration/jobs' "$request")
    case $code in
      201 | 200) regenerated=$((regenerated + 1)) ;;
      # The Place lost its text between the query and now.
      404) ;;
      *) fail "regenerating $place_id: HTTP $code $(cat "$work/regenerate.json")" ;;
    esac
  done <"$work/targets.txt"
  echo "✓ regenerated $regenerated Place(s)"
fi

step '3. wait for the Places to come back'
stuck() {
  catalog_sql "SELECT count(*) FROM places WHERE deleted_at IS NULL AND status = 'PROCESSING'"
}
# A task still failing is narration's problem, not a language the voices do not cover: a
# localization legitimately ends `FAILED` where no provider has a voice for it (rdm-spec C-4's
# `NO_VOICE`), and those never become READY however often this runs.
failed_tasks() {
  narration_sql "SELECT count(*) FROM synthesis_tasks WHERE status = 'FAILED'"
}
deadline=$((SECONDS + timeout))
while (( SECONDS < deadline )); do
  [[ $(stuck) == 0 && $(failed_tasks) == 0 ]] && break
  sleep 5
done
printf '\n'
[[ $(stuck) == 0 && $(failed_tasks) == 0 ]] ||
  fail "still $(stuck) Place(s) PROCESSING and $(failed_tasks) synthesis task(s) FAILED after ${timeout}s"
echo "✓ no Place is PROCESSING and no synthesis task is FAILED"

step '4. every published audio object is really there'
# Live Places only: a deleted Place is served to nobody, and its audio went with the bucket.
catalog_sql "
  SELECT DISTINCT l.audio_object_path
  FROM place_localizations l JOIN places p ON p.id = l.place_id
  WHERE l.audio_status = 'READY' AND l.audio_object_path IS NOT NULL
    AND p.deleted_at IS NULL" >"$work/audio.txt"
missing=0
checked=0
while read -r path; do
  [[ -n $path ]] || continue
  checked=$((checked + 1))
  [[ $(curl -sS -o /dev/null -w '%{http_code}' "$media_base/$path") == 200 ]] || {
    missing=$((missing + 1))
    echo "  ✗ $path"
  }
done <"$work/audio.txt"
[[ $missing == 0 ]] || fail "$missing of $checked published audio object(s) are missing"
echo "✓ all $checked published audio objects answer 200"
