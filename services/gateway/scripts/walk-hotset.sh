#!/usr/bin/env bash
# Live walk of narration's tourist surface (api-endpoints-plan §4.1–4.2): the language
# switch's hotset, the walk-ahead prefetch, audio tier 2, and the UI string bundles. It runs
# against a running stack (identity, catalog, gateway, fake-gcs, NATS, Redis); narration itself is
# started by this script with the fake providers: build it first and leave it stopped.
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: pnpm --filter @wayfare/narration build && services/gateway/scripts/walk-hotset.sh
#   Step 0 runs `pnpm seed:dev`; the walk's Places are created in the seeded pilot area and
#   deleted at the end. BASE, ROOT and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
NARRATION_OPS=${NARRATION_OPS:-http://localhost:3103}
APP_VERSION=${APP_VERSION:-1.0.0}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
narration_pid=''
cleanup() {
  forget_places
  [[ -n $narration_pid ]] && kill "$narration_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

mobile=(-H 'x-wayfare-client: mobile' -H "x-wayfare-app-version: $APP_VERSION" -H 'content-type: application/json')

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
device() { echo "authorization: Bearer $(cat "$work/device.token")"; }
# A second phone for the stream: the narration rate class is per device, and step 4 spends the
# first phone's whole allowance on purpose.
device2() { echo "authorization: Bearer $(cat "$work/device2.token")"; }

# stop_narration — stops it, so an edit leaves work undone for the hotset to find.
stop_narration() {
  [[ -n $narration_pid ]] || return 0
  kill "$narration_pid" 2>/dev/null || true
  wait "$narration_pid" 2>/dev/null || true
  narration_pid=''
  echo '✓ narration stopped'
}

# start_narration [VAR=value…] — (re)starts narration with these variables over its .env.
start_narration() {
  stop_narration >/dev/null
  (cd "$repo_root/services/narration" && exec env "$@" node . >>"$work/narration.log" 2>&1) &
  narration_pid=$!
  local attempt
  for attempt in $(seq 1 50); do
    curl -sS -o /dev/null "$NARRATION_OPS/health/ready" 2>/dev/null && {
      echo "✓ narration ready${*:+ with $*}"
      wait_for 'the gateway reaches narration' 20 gateway_sees_narration
      return
    }
    sleep 0.2
  done
  tail -20 "$work/narration.log"
  fail 'narration did not become ready in 10 s'
}

# gateway_sees_narration — the gateway's own channel is connected again. grpc-js keeps a failing
# subchannel for a moment after a peer restarts, so the first call through it would be a 503.
gateway_sees_narration() {
  [[ -f $work/device.token ]] || return 0
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    "$BASE/narration/places/01a0b373-d3eb-73c0-bd63-b96a868ab216/status?lang=en" \
    "${mobile[@]}" -H "$(device)")
  [[ $code != 503 ]]
}

place_status() { curl -sS "$BASE/admin/places/$1" "${console[@]}" -b "$(admin)" | jq -r .data.status; }
is_active() { [[ $(place_status "$1") == ACTIVE ]]; }
asset_count() { narration_sql 'SELECT count(*) FROM audio_assets'; }
job_count() { narration_sql "SELECT count(*) FROM synthesis_jobs WHERE target_id = '$1' AND trigger = '$2'"; }
# fresh_audio PLACE LANG — the status route serves audio made from the text being served (C-4).
fresh_audio() {
  [[ $(curl -sS "$BASE/narration/places/$1/status?lang=$2" "${mobile[@]}" -H "$(device)" |
    jq -r '.data.audio != null and .data.stale == false') == true ]]
}
# blank_audio PLACE LANG — forgets the stored audio of one language, leaving the text as it is.
# It stands in for a corpus never voiced in that language: the Place stays live and readable, and
# only its audio is missing, which is the state a language switch exists to fix (rdm-spec C-4).
blank_audio() {
  catalog_sql "UPDATE place_localizations
    SET audio_status = 'PENDING', audio_source_content_hash = NULL, audio_object_path = NULL,
        audio_sha256 = NULL, audio_bytes = NULL, audio_duration_ms = NULL
    WHERE place_id = '$1' AND lang = '$2'" >/dev/null
}
# forget_audio PLACE LANG — drops the stored file from both sides: the Place's row in catalog and
# the cache row in narration. The text stays, so the Place is still live — it is simply a Place
# whose audio nobody has made (rdm-spec N-3).
forget_audio() {
  local path
  path=$(catalog_sql "SELECT audio_object_path FROM place_localizations
    WHERE place_id = '$1' AND lang = '$2'")
  [[ -n $path ]] && narration_sql "DELETE FROM audio_assets WHERE object_path = '$path'" >/dev/null
  blank_audio "$1" "$2"
}
newest_job() {
  narration_sql "SELECT id FROM synthesis_jobs WHERE target_id = '$1' ORDER BY created_at DESC, id DESC LIMIT 1"
}
bundle_status() {
  narration_sql "SELECT status FROM ui_bundles WHERE namespace = 'tourist' AND locale = '$1' ORDER BY created_at DESC LIMIT 1"
}
bundle_is_ready() { [[ $(bundle_status "$1") == READY ]]; }

# create_place KEY INDEX NAME DESCRIPTION — an Editorial Place with requestActivation.
create_place() {
  local lat lng
  read -r lat lng < <(walk_location "$2")
  call "create-$1" 201 -X POST "$BASE/admin/places" "${console[@]}" -b "$(admin)" -d "$(body \
    --arg name "$3" --arg description "$4" --argjson lat "$lat" --argjson lng "$lng" '{
      nameVi: $name, descriptionVi: $description, categoryCode: "LANDMARK",
      location: {lat: $lat, lng: $lng}, triggerRadiusM: 40, narrationPriority: 70,
      photos: [], openingHours: [], requestActivation: true
    }')"
  remember_place "$(json "create-$1" .data.place.id)"
}

reset_local_state
stamp=$(date +%s)
# The walk's own language. Every launch language is voiced when a Place goes live, so the walk
# makes its own gap: it edits the Vietnamese with narration stopped, which leaves every language's
# audio a version behind and gives the hotset something real to warm.
LANG_TAG=ko

step '0. seed; sign in; register a device; start narration'
seed_dev
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
call device-register 201 -X POST "$BASE/devices" "${mobile[@]}" \
  -d '{"platform":"ANDROID","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'
json device-register .data.accessToken >"$work/device.token"
call device2-register 201 -X POST "$BASE/devices" "${mobile[@]}" \
  -d '{"platform":"IOS","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'
json device2-register .data.accessToken >"$work/device2.token"
start_narration

step '1. four Places: three around one point, and one for the stream'
create_place one 1 "Bảo tàng hotset $stamp" 'Bảo tàng mở cửa năm 1920.'
create_place two 2 "Nhà hát hotset $stamp" 'Nhà hát xây năm 1900.'
create_place three 3 "Công viên hotset $stamp" 'Công viên bên sông.'
create_place four 9 "Bến tàu hotset $stamp" 'Bến tàu bên sông Sài Gòn.'
place_one=$(json create-one .data.place.id)
place_two=$(json create-two .data.place.id)
place_three=$(json create-three .data.place.id)
place_four=$(json create-four .data.place.id)
for id in "$place_one" "$place_two" "$place_three" "$place_four"; do
  wait_for "Place $id is ACTIVE" 120 is_active "$id"
done
read -r walk_lat walk_lng < <(walk_location 2)
echo "✓ three Places live around $walk_lat $walk_lng"

step "2. three Places with no $LANG_TAG audio, then the language switch"
for id in "$place_one" "$place_two" "$place_three"; do
  blank_audio "$id" "$LANG_TAG"
done
# This run's jobs only: the database keeps every earlier walk's.
since=$(narration_sql 'SELECT now()')
echo "✓ the three Places have text but no $LANG_TAG audio"
call hotset 200 -X POST "$BASE/narration/hotset" "${mobile[@]}" -H "$(device)" \
  -d "$(body --argjson lat "$walk_lat" --argjson lng "$walk_lng" --arg lang "$LANG_TAG" \
    '{lat: $lat, lng: $lng, lang: $lang}')"
[[ $(json hotset .data.requiredReadyCount) == 3 ]] || fail 'requiredReadyCount is not 3'
mine=$(json hotset "[.data.ready[], .data.pending[]] | map(select(. == \"$place_one\" or . == \"$place_two\" or . == \"$place_three\")) | length")
[[ $mine == 3 ]] || fail "the hotset answered $mine of the walk's three Places"
for id in "$place_one" "$place_two" "$place_three"; do
  [[ $(json hotset "[.data.pending[]] | index(\"$id\") != null") == true ]] ||
    fail "$id is not pending, though its audio is a version behind"
done
total=$(json hotset '(.data.ready | length) + (.data.pending | length)')
[[ $total -le 10 ]] || fail "the hotset answered $total Places, more than HOTSET_MAX_PLACES"
echo "✓ $total Places within 1500 m, $(json hotset '.data.pending | length') being made, requiredReadyCount 3"

for id in "$place_one" "$place_two" "$place_three"; do
  [[ $(job_count "$id" HOTSET) -ge 1 ]] || fail "no HOTSET job for $id"
done
warmed=$(narration_sql "SELECT count(DISTINCT target_id) FROM synthesis_jobs WHERE trigger = 'HOTSET' AND created_at > '$since'")
pending=$(json hotset '.data.pending | length')
[[ $warmed -le $pending ]] || fail "$warmed Places have HOTSET jobs, but only $pending were pending"
echo "✓ a HOTSET job for each of the $pending pending Places, and for no other"
[[ $(job_count "$place_four" HOTSET) == 0 ]] || fail 'the Place outside the radius was warmed'

step '3. asking again buys nothing, and everything ends ready'
before=$(narration_sql "SELECT count(*) FROM synthesis_tasks WHERE coalesced_into_task_id IS NULL")
call hotset-again 200 -X POST "$BASE/narration/hotset" "${mobile[@]}" -H "$(device)" \
  -d "$(body --argjson lat "$walk_lat" --argjson lng "$walk_lng" --arg lang "$LANG_TAG" \
    '{lat: $lat, lng: $lng, lang: $lang}')"
[[ $(narration_sql "SELECT count(*) FROM synthesis_tasks WHERE coalesced_into_task_id IS NULL") == "$before" ]] ||
  fail 'the second hotset added work instead of coalescing'
echo "✓ the second call coalesced: still $before tasks doing work"

for id in "$place_one" "$place_two" "$place_three"; do
  wait_for "$id is heard in $LANG_TAG" 180 fresh_audio "$id" "$LANG_TAG"
done
call hotset-ready 200 -X POST "$BASE/narration/hotset" "${mobile[@]}" -H "$(device)" \
  -d "$(body --argjson lat "$walk_lat" --argjson lng "$walk_lng" --arg lang "$LANG_TAG" \
    '{lat: $lat, lng: $lng, lang: $lang}')"
mine_pending=$(json hotset-ready "[.data.pending[]] | map(select(. == \"$place_one\" or . == \"$place_two\" or . == \"$place_three\")) | length")
[[ $mine_pending == 0 ]] || fail "still $mine_pending of the walk's Places pending"
echo "✓ the walk's Places are all ready; the switch would complete"

step '4. prefetch: what it queues, what it skips, and where it sits in the queue'
# The fourth Place has no Japanese audio, and the first has: one is queued and one is skipped.
blank_audio "$place_four" ja
call prefetch 202 -X POST "$BASE/narration/prefetch" "${mobile[@]}" -H "$(device)" \
  -d "$(body --arg a "$place_four" --arg b "$place_one" '{placeIds: [$a, $b], lang: "ja"}')"
[[ $(json prefetch '.data.queued') == *"$place_four"* ]] || fail 'the prefetch queued nothing for the stale Place'
[[ $(json prefetch '.data.skipped') == *"$place_one"* ]] || fail 'a Place already heard was not skipped'
echo "✓ 202: $(json prefetch '.data.queued | length') queued, $(json prefetch '.data.skipped | length') skipped"
[[ $(job_count "$place_four" PREFETCH) -ge 1 ]] || fail 'no PREFETCH job was created'
[[ $(narration_sql "SELECT priority FROM synthesis_jobs WHERE trigger = 'PREFETCH' ORDER BY created_at DESC LIMIT 1") -gt \
   $(narration_sql "SELECT priority FROM synthesis_jobs WHERE trigger = 'HOTSET' ORDER BY created_at DESC LIMIT 1") ]] ||
  fail 'a prefetch job does not sit behind a hotset job'
echo '✓ PREFETCH sits behind HOTSET in the queue'

call prefetch-four 400 -X POST "$BASE/narration/prefetch" "${mobile[@]}" -H "$(device)" \
  -d "$(body --arg a "$place_one" --arg b "$place_two" --arg c "$place_three" \
    '{placeIds: [$a, $b, $c, "01a0b373-d3eb-73c0-bd63-b96a868ab216"], lang: "ja"}')"
echo '✓ four ids → 400'

limited=''
for attempt in $(seq 1 40); do
  code=$(curl -sS -o "$work/rl.json" -D "$work/rl.h" -w '%{http_code}' -X POST "$BASE/narration/prefetch" \
    "${mobile[@]}" -H "$(device)" -d "$(body --arg a "$place_one" '{placeIds: [$a], lang: "ja"}')")
  [[ $code == 429 ]] && { limited=$attempt; break; }
done
[[ -n $limited ]] || fail 'the device narration rate class never refused'
grep -qi '^retry-after:' "$work/rl.h" || fail '429 carries no Retry-After'
echo "✓ 429 with Retry-After on call $limited (NARRATION_ON_DEMAND, shared with on-demand)"

step '5. the stream: audio now, stored for the next tourist'
# A Place whose audio is forgotten on both sides — catalog's row and narration's cache — so
# nothing is stored for this text and the stream has to make it.
stream_place=$place_four
stream_lang=$LANG_TAG
forget_audio "$stream_place" "$stream_lang"
assets_before=$(asset_count)
stream_status=$(curl -sS -o "$work/stream.mp3" -D "$work/stream.h" -w '%{http_code}' \
  "$BASE/narration/tts/stream?placeId=$stream_place&lang=$stream_lang" "${mobile[@]}" -H "$(device2)")
[[ $stream_status == 200 ]] || { cat "$work/stream.mp3"; fail "the stream answered HTTP $stream_status"; }
grep -qi '^content-type: audio/mpeg' "$work/stream.h" || fail 'the stream is not audio/mpeg'
grep -qi '^cache-control:.*no-store' "$work/stream.h" || fail 'the stream is not no-store'
[[ $(stat -c%s "$work/stream.mp3") -gt 0 ]] || fail 'the stream returned no bytes'
echo "✓ $(stat -c%s "$work/stream.mp3") bytes of audio/mpeg, no-store"
[[ $(asset_count) -gt $assets_before ]] ||
  fail "the stream stored nothing: $assets_before assets before, $(asset_count) after"

assets_after=$(asset_count)

wait_for "$stream_lang is served from storage" 60 fresh_audio "$stream_place" "$stream_lang"
echo '✓ the status route now answers with the audio of the text being served, so catalog serves it'

stream_again=$(curl -sS -o /dev/null -w '%{http_code}' \
  "$BASE/narration/tts/stream?placeId=$stream_place&lang=$stream_lang" "${mobile[@]}" -H "$(device2)")
[[ $stream_again == 200 ]] || fail "the second stream answered HTTP $stream_again"
[[ $(asset_count) == "$assets_after" ]] || fail 'the second stream synthesized again'
echo "✓ the second stream reused the stored object — still $assets_after audio assets"

call stream-no-voice 409 "$BASE/narration/tts/stream?placeId=$stream_place&lang=xx" \
  "${mobile[@]}" -H "$(device2)"
[[ $(json stream-no-voice .error.details.status) == NO_VOICE ]] || fail 'a language with no voice is not NO_VOICE'
grep -qi '^content-type: application/json' "$work/stream-no-voice.h" ||
  fail 'a refusal is not a JSON envelope'
echo '✓ a language with no voice → 409 NO_VOICE, as JSON'

step '6. the UI bundles'
# An earlier walk may have translated Thai already; this one starts where a first request does.
narration_sql "DELETE FROM ui_bundles WHERE namespace = 'tourist' AND locale = 'th'" >/dev/null
call bundle-vi 200 "$BASE/i18n/bundles/tourist/vi" "${mobile[@]}"
[[ $(json bundle-vi .data.status) == READY ]] || fail 'the Vietnamese bundle is not READY'
[[ $(json bundle-vi '.data.messages["nav.explore"]') == 'Khám phá' ]] || fail 'the Vietnamese strings are missing'
vi_hash=$(json bundle-vi .data.sourceHash)
etag=$(grep -i '^etag:' "$work/bundle-vi.h" | tr -d '\r' | cut -d' ' -f2-)
[[ $etag == "\"$vi_hash\"" ]] || fail "the ETag $etag is not the source hash"
grep -qi '^cache-control: public, max-age=3600, stale-while-revalidate=86400' "$work/bundle-vi.h" ||
  fail 'a ready bundle is not cached hard'
echo "✓ READY, ETag ${vi_hash:0:12}…, cached for an hour"

call bundle-304 304 "$BASE/i18n/bundles/tourist/vi" "${mobile[@]}" -H "if-none-match: $etag"
echo '✓ If-None-Match → 304'
call bundle-hint 200 "$BASE/i18n/bundles/tourist/vi?sourceHash=$(printf 'b%.0s' {1..64})" "${mobile[@]}"
[[ $(json bundle-hint .data.sourceHash) == "$vi_hash" ]] || fail 'an older ?sourceHash= was taken as a validator'
echo '✓ an older ?sourceHash= still gets the current bundle'

call bundle-th 200 "$BASE/i18n/bundles/tourist/th" "${mobile[@]}"
[[ $(json bundle-th .data.status) == PENDING ]] || fail 'the Thai bundle is not PENDING'
[[ $(json bundle-th '.data.messages["nav.explore"]') == 'Explore' ]] || fail 'the pending bundle is not English'
grep -qi '^retry-after:' "$work/bundle-th.h" || fail 'a pending bundle carries no Retry-After'
grep -qi '^cache-control: no-store' "$work/bundle-th.h" || fail 'a pending bundle is cached'
echo '✓ PENDING: English now, no-store, Retry-After'

wait_for 'the Thai bundle is translated' 60 bundle_is_ready th
call bundle-th-ready 200 "$BASE/i18n/bundles/tourist/th" "${mobile[@]}"
[[ $(json bundle-th-ready .data.status) == READY ]] || fail 'the Thai bundle did not become READY'
[[ $(json bundle-th-ready '.data.messages["nav.explore"]') == '[th] Explore' ]] ||
  fail 'the Thai bundle holds no translation'
echo "✓ READY in Thai, $(json bundle-th-ready '.data.failedKeys | length') keys served in English"

step 'done'
printf '\n✓ walk-hotset: every step passed\n'
