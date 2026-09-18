#!/usr/bin/env bash
# Live walk of narration with the fake providers against a running stack (identity, catalog,
# gateway, fake-gcs, NATS, Redis). narration itself is started — and restarted with the walk's
# variables — by this script: build it first and leave it stopped.
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: pnpm --filter @wayfare/narration build && services/gateway/scripts/walk-narration.sh
#   BASE, ROOT, NARRATION_OPS and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden. The
#   failing-provider steps wait for retries, so the whole walk takes about two minutes.
set -euo pipefail

ROOT=${ROOT:-http://localhost:3000}
BASE=${BASE:-$ROOT/api/v1}
NARRATION_OPS=${NARRATION_OPS:-http://localhost:3103}
APP_VERSION=${APP_VERSION:-1.0.0}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
narration_pid=''
socket_pids=()
cleanup() {
  for pid in "${socket_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  [[ -n $narration_pid ]] && kill "$narration_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

mobile=(-H 'x-wayfare-client: mobile' -H "x-wayfare-app-version: $APP_VERSION" -H 'content-type: application/json')

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
device() { echo "authorization: Bearer $(cat "$work/device.token")"; }

# narration_sql SQL — runs SQL against the local narration database and prints the bare result.
narration_sql() {
  (cd "$repo_root" && docker compose exec -T narration-db \
    psql -U wayfare -d wayfare_narration -At -v ON_ERROR_STOP=1 -c "$1")
}

# start_narration [VAR=value…] — (re)starts narration with these variables over its .env, and
# waits for it to be ready.
start_narration() {
  if [[ -n $narration_pid ]]; then
    kill "$narration_pid" 2>/dev/null || true
    wait "$narration_pid" 2>/dev/null || true
  fi
  (cd "$repo_root/services/narration" && exec env "$@" node . >>"$work/narration.log" 2>&1) &
  narration_pid=$!
  local attempt
  for attempt in $(seq 1 50); do
    curl -sS -o /dev/null "$NARRATION_OPS/health/ready" 2>/dev/null && {
      echo "✓ narration ready${*:+ with $*}"
      return
    }
    sleep 0.2
  done
  tail -20 "$work/narration.log"
  fail 'narration did not become ready in 10 s'
}

# socket NAME TOKEN [JOB_ID] — a console socket recording its frames to $work/NAME.frames.
socket() {
  (cd "$repo_root/services/gateway" && TOKEN=$2 WS_URL="$ROOT/ws" exec \
    node scripts/walk-socket.mjs "$work/$1.frames" ${3:+"$3"}) &
  socket_pids+=($!)
}

# frames NAME JQ — the recorded frames of a socket, filtered.
frames() { [[ -f $work/$1.frames ]] && jq -s "$2" "$work/$1.frames" || echo '[]'; }

# wait_for WHAT SECONDS COMMAND… — polls COMMAND until it succeeds.
wait_for() {
  local what=$1 seconds=$2 attempt
  shift 2
  for attempt in $(seq 1 $((seconds * 5))); do
    "$@" >/dev/null 2>&1 && { echo "✓ $what"; return; }
    sleep 0.2
  done
  fail "$what: not within $seconds s"
}

place_status() { curl -sS "$BASE/admin/places/$1" "${console[@]}" -b "$(admin)" | jq -r .data.status; }
is_active() { [[ $(place_status "$1") == ACTIVE ]]; }
job_status() { narration_sql "SELECT status FROM synthesis_jobs WHERE id = '$1'"; }
job_is() { [[ $(job_status "$1") == "$2" ]]; }
newest_job() {
  narration_sql "SELECT id FROM synthesis_jobs WHERE target_id = '$1' ORDER BY created_at DESC, id DESC LIMIT 1"
}
has_job() { [[ -n $(narration_sql "SELECT id FROM synthesis_jobs WHERE target_id = '$1' AND source_content_hash = '$2'") ]]; }
ready_count() {
  narration_sql "SELECT count(*) FROM outbox_events WHERE subject = 'narration.localization.ready' AND aggregate_id = '$1' $2"
}
asset_count() { narration_sql 'SELECT count(*) FROM audio_assets'; }
max_attempts() { narration_sql "SELECT COALESCE(max(attempts), 0) FROM synthesis_tasks WHERE job_id = '$1'"; }
sum_attempts() { narration_sql "SELECT COALESCE(sum(attempts), 0) FROM synthesis_tasks WHERE job_id = '$1'"; }

# Conditions for wait_for, re-evaluated on every poll.
saw() { [[ $(frames "$1" "[.[] | select(.event == \"$2\")] | length") -ge 1 ]]; }
retried() { [[ $(max_attempts "$1") -ge 1 ]]; }
attempts_above() { [[ $(sum_attempts "$1") -gt $2 ]]; }
has_any_job() { [[ -n $(newest_job "$1") ]]; }
answered() { [[ $(cat "$work"/od-*.status 2>/dev/null | wc -l) -eq $1 ]]; }

# create_place KEY NAME DESCRIPTION — an Editorial Place with requestActivation; the answer is
# $work/create-KEY.json.
create_place() {
  call "create-$1" 201 -X POST "$BASE/admin/places" "${console[@]}" -b "$(admin)" -d "$(body \
    --arg name "$2" --arg description "$3" '{
      nameVi: $name, descriptionVi: $description, categoryCode: "LANDMARK",
      location: {lat: 10.7766, lng: 106.7031}, triggerRadiusM: 40, narrationPriority: 70,
      photos: [], openingHours: [], requestActivation: true
    }')"
}

reset_local_state
stamp=$(date +%s)

step '0. sign in, register a device and a plain account, insert the category and the area'
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
call plain-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d '{"email":"walk-narration-'"$stamp"'@example.com","password":"correct horse battery","preferredLocale":"en","termsVersion":"2026-09-01"}'
cookie_value plain-register wf_at >"$work/plain.at"
call device-register 201 -X POST "$BASE/devices" "${mobile[@]}" \
  -d '{"platform":"ANDROID","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'
json device-register .data.accessToken >"$work/device.token"
catalog_sql "INSERT INTO categories (id, code, applies_to, icon, sort_order)
  VALUES ('01990000-0000-7000-8000-00000000c001', 'LANDMARK', 'ANY', 'landmark', 0)
  ON CONFLICT (code) DO UPDATE SET is_active = true" >/dev/null
catalog_sql "UPDATE areas SET is_active = false WHERE code LIKE 'walk-%'" >/dev/null
area_id=$(catalog_node 'process.stdout.write(require("@wayfare/contracts").newId())')
catalog_sql "INSERT INTO areas (id, code, name_vi, boundary, center, default_zoom, is_active)
  VALUES ('$area_id', 'walk-$stamp', 'Khu thử',
    ST_GeogFromText('POLYGON((106.69 10.765, 106.71 10.765, 106.71 10.78, 106.69 10.78, 106.69 10.765))'),
    ST_SetSRID(ST_MakePoint(106.7, 10.7725), 4326)::geography, 15, true)" >/dev/null
echo "✓ area $area_id"
start_narration

step '1. a monitor socket as the super admin'
socket monitor "$(cat "$work/admin.at")"
wait_for 'the monitor received connection:ready' 5 saw monitor connection:ready

step '2. an Editorial Place with requestActivation'
create_place theatre "Nhà hát $stamp" 'Nhà hát xây năm 1900. Theo phong cách Pháp.'
place_id=$(json create-theatre .data.place.id)
hash=$(json create-theatre .data.place.contentHash)
echo "✓ Place $place_id"

step '3. it goes live on its own; nine ready events; sync lists en audio; the monitor saw the job'
wait_for 'the Place is ACTIVE' 30 is_active "$place_id"
first_job=$(newest_job "$place_id")
wait_for 'the first job COMPLETED' 30 job_is "$first_job" COMPLETED
[[ $(ready_count "$place_id" "AND payload->>'sourceContentHash' = '$hash'") == 9 ]] ||
  fail "$(ready_count "$place_id" "AND payload->>'sourceContentHash' = '$hash'") ready events, not 9"
[[ $(ready_count "$place_id" "AND payload->>'sourceContentHash' = '$hash' AND payload ? 'audio'") == 5 ]] ||
  fail 'not five ready events with audio'
[[ $(ready_count "$place_id" "AND payload->>'lang' = 'vi'") == 1 ]] || fail 'vi was published more than once'
echo '✓ nine narration.localization.ready: four text-only, five with audio, vi once'
sleep 6
call sync 200 "$BASE/sync/places?areaId=$area_id&lang=en" "${mobile[@]}" -H "$(device)"
[[ $(json sync "[.data.places[] | select(.id == \"$place_id\")] | .[0].localization.audio != null") == true ]] ||
  fail 'sync does not list the Place with en audio'
echo '✓ sync lists the Place with en audio'
[[ $(frames monitor "[.[] | select(.event == \"narration:job:status\" and .payload.jobId == \"$first_job\")] | length") -ge 1 ]] ||
  fail 'the monitor received no narration:job:status frame for the job'
[[ $(frames monitor "[.[] | select(.event == \"narration:job:status\" and .payload.jobId == \"$first_job\" and .payload.status == \"COMPLETED\")] | length") -ge 1 ]] ||
  fail 'the monitor never saw the job complete'
echo '✓ the monitor saw the job run and complete'

step '4. regenerating the same text: every task a cache hit, no new asset'
assets_before=$(asset_count)
call regenerate 201 -X POST "$BASE/admin/narration/jobs" "${console[@]}" -b "$(admin)" \
  -d "$(body --arg id "$place_id" '{targetType: "PLACE", targetId: $id, langs: ["vi","en","zh-Hans","ja","ko"], includeAudio: true}')"
regen_job=$(json regenerate .data.job.id)
wait_for 'the regenerate job COMPLETED' 30 job_is "$regen_job" COMPLETED
[[ $(asset_count) == "$assets_before" ]] || fail "audio assets went from $assets_before to $(asset_count)"
echo "✓ still $assets_before audio assets"

step '5 and 7. a text edit while a job runs; the job monitor streams its tasks'
start_narration FAKE_PROVIDER_FAILURES=speech
call edit-a 200 -X PATCH "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)" \
  -d '{"descriptionVi":"Nhà hát xây năm 1900. Nay là nơi biểu diễn."}'
hash_a=$(json edit-a .data.place.contentHash)
wait_for 'a job for the first edit' 10 has_job "$place_id" "$hash_a"
job_a=$(newest_job "$place_id")
socket subscriber "$(cat "$work/admin.at")" "$job_a"
socket outsider "$(cat "$work/plain.at")" "$job_a"
wait_for 'the monitor subscribed to the job' 5 saw subscriber job:subscribed
wait_for 'the outsider was answered' 5 saw outsider error
wait_for 'a failing attempt retried' 20 retried "$job_a"
wait_for 'narration:task:progress frames streamed' 20 saw subscriber narration:task:progress
[[ $(frames outsider '[.[] | select(.event == "error")][0].payload.code') == '"PERMISSION_DENIED"' ]] ||
  fail 'a non-admin socket was not refused job:subscribe'
[[ $(frames outsider '[.[] | select(.event == "narration:job:status" or .event == "narration:task:progress")] | length') == 0 ]] ||
  fail 'a non-admin socket received job frames'
echo '✓ a non-admin socket gets no job frames, and job:subscribe answers PERMISSION_DENIED'
call pause-a 200 -X POST "$BASE/admin/narration/jobs/$job_a/pause" "${console[@]}" -b "$(admin)"
start_narration
call edit-b 200 -X PATCH "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)" \
  -d '{"descriptionVi":"Nhà hát xây năm 1900. Nay là nhà hát lớn của thành phố."}'
hash_b=$(json edit-b .data.place.contentHash)
wait_for 'a job for the second edit' 10 has_job "$place_id" "$hash_b"
[[ $(job_status "$job_a") == SUPERSEDED ]] || fail "the first edit's job is $(job_status "$job_a"), not SUPERSEDED"
[[ $(narration_sql "SELECT count(*) FROM synthesis_tasks WHERE job_id = '$job_a' AND status NOT IN ('CANCELLED', 'SUCCEEDED')") == 0 ]] ||
  fail "the superseded job's waiting tasks were not cancelled"
echo "✓ the first edit's job SUPERSEDED, its waiting tasks CANCELLED"
wait_for 'the Place is ACTIVE again' 30 is_active "$place_id"
wait_for "the second edit's job COMPLETED" 30 job_is "$(newest_job "$place_id")" COMPLETED
call detail 200 "$BASE/places/$place_id?lang=en" "${mobile[@]}" -H "$(device)"
[[ $(json detail .data.localization.description) == *'nhà hát lớn'* ]] || fail 'catalog does not serve the new text'
[[ $(json detail .data.localization.audio.url) == *"/audio/"* ]] || fail 'catalog serves no audio for the new text'
[[ $(json detail .data.localization.stale) == false ]] || fail 'the served text is stale'
echo '✓ after both jobs settle, catalog serves the new text and its audio'

step '6. twenty on-demand requests for fr: one job, one task; text ready, no voice'
for i in $(seq 1 20); do
  curl -sS -o "$work/od-$i.json" -w '%{http_code}\n' -X POST "$BASE/narration/on-demand" "${mobile[@]}" \
    -H "$(device)" -d "$(body --arg id "$place_id" '{placeId: $id, lang: "fr"}')" >"$work/od-$i.status" &
done
wait_for 'twenty answers' 10 answered 20
[[ $(sort -u "$work"/od-*.status) == 202 ]] || fail "on-demand answered $(sort -u "$work"/od-*.status | tr '\n' ' ')"
[[ $(jq -s '[.[].data.jobId] | unique | length' "$work"/od-*.json) == 1 ]] || fail 'the twenty answers name several jobs'
od_job=$(jq -r .data.jobId "$work/od-1.json")
[[ $(narration_sql "SELECT count(*) FROM synthesis_jobs WHERE target_id = '$place_id' AND trigger = 'ON_DEMAND'") == 1 ]] ||
  fail 'more than one on-demand job'
[[ $(narration_sql "SELECT count(*) FROM synthesis_tasks WHERE job_id = '$od_job'") == 1 ]] || fail 'the job has more than one task'
echo "✓ one ON_DEMAND job ($od_job) with one task, every caller 202 with its id"
wait_for 'the on-demand job COMPLETED' 20 job_is "$od_job" COMPLETED
sleep 1
call od-status 200 "$BASE/narration/places/$place_id/status?lang=fr" "${mobile[@]}" -H "$(device)"
grep -qi '^cache-control: private, max-age=2' "$work/od-status.h" || fail 'the status route is not privately cached'
[[ $(json od-status .data.textReady) == true && $(json od-status .data.audioStatus) == FAILED ]] ||
  fail "status is $(jq -c .data "$work/od-status.json")"
echo '✓ fr: textReady, audioStatus FAILED (no voice)'

step '8. pause, resume, cancel and retry with one worker and a failing speech provider'
start_narration SYNTHESIS_CONCURRENCY=1 FAKE_PROVIDER_FAILURES=speech
create_place post-office "Bưu điện $stamp" 'Bưu điện xây năm 1886. Mái vòm bằng thép.'
second_id=$(json create-post-office .data.place.id)
wait_for 'a job for the second Place' 10 has_any_job "$second_id"
job_p=$(newest_job "$second_id")
wait_for 'its tasks failed once' 20 retried "$job_p"
call pause-p 200 -X POST "$BASE/admin/narration/jobs/$job_p/pause" "${console[@]}" -b "$(admin)"
held=$(sum_attempts "$job_p")
sleep 7
[[ $(sum_attempts "$job_p") == "$held" ]] ||
  fail 'a paused job kept running its queued tasks'
[[ $(narration_sql "SELECT count(*) FROM synthesis_tasks WHERE job_id = '$job_p' AND status = 'RUNNING'") == 0 ]] ||
  fail 'a paused job has running tasks'
echo '✓ pause holds the queued tasks'
call resume-p 200 -X POST "$BASE/admin/narration/jobs/$job_p/resume" "${console[@]}" -b "$(admin)"
wait_for 'resume runs them again' 20 attempts_above "$job_p" "$held"
published_before=$(ready_count "$second_id" "AND payload ? 'audio'")
call cancel-p 200 -X POST "$BASE/admin/narration/jobs/$job_p/cancel" "${console[@]}" -b "$(admin)"
[[ $(json cancel-p .data.job.status) == CANCELLED ]] || fail 'the job is not CANCELLED'
sleep 7
[[ $(narration_sql "SELECT count(*) FROM synthesis_tasks WHERE job_id = '$job_p' AND status IN ('QUEUED', 'RUNNING')") == 0 ]] ||
  fail 'a cancelled job still has live tasks'
[[ $(ready_count "$second_id" "AND payload ? 'audio'") == "$published_before" ]] || fail 'a cancelled job published audio'
echo '✓ cancel stops the tasks without publishing'

call regenerate-p 201 -X POST "$BASE/admin/narration/jobs" "${console[@]}" -b "$(admin)" \
  -d "$(body --arg id "$second_id" '{targetType: "PLACE", targetId: $id, langs: ["en"], includeAudio: true}')"
job_r=$(json regenerate-p .data.job.id)
wait_for 'the regenerate job FAILED after its attempts' 60 job_is "$job_r" FAILED
[[ $(narration_sql "SELECT attempts FROM synthesis_tasks WHERE job_id = '$job_r'") == 3 ]] || fail 'the task did not use its three attempts'
start_narration
call retry-r 200 -X POST "$BASE/admin/narration/jobs/$job_r/retry-failed" "${console[@]}" -b "$(admin)"
wait_for 'the retried job COMPLETED' 30 job_is "$job_r" COMPLETED
echo '✓ retry-failed re-ran the failed task'
call providers 200 "$BASE/admin/narration/providers" "${console[@]}" -b "$(admin)"
[[ $(json providers '[.data[] | select(.scope == "process")] | length') -ge 2 ]] || fail 'providers are not reported'

printf '\n✓ narration walk complete\n'
