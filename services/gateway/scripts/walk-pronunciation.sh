#!/usr/bin/env bash
# Live walk of the pronunciation dictionary and staff translation corrections (api-endpoints-plan
# §4.4–4.5, rdm-spec N-5, N-7) against a running stack (identity, catalog, gateway, fake-gcs, NATS,
# Redis). narration itself is started by this script with the fake providers: build it first and
# leave it stopped.
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: pnpm --filter @wayfare/narration build && services/gateway/scripts/walk-pronunciation.sh
#   Needs SEED_ACCOUNT_PASSWORD in services/identity/.env (moderator@wayfare.test). Step 0 runs
#   `pnpm seed:dev`; the walk's Places are created in the seeded pilot area and deleted at the end.
#   BASE, ROOT and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
NARRATION_OPS=${NARRATION_OPS:-http://localhost:3103}
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

seed_password=$(grep -E '^SEED_ACCOUNT_PASSWORD=.+' "$repo_root/services/identity/.env" | cut -d= -f2- || true)
[[ -n $seed_password ]] || fail 'set SEED_ACCOUNT_PASSWORD in services/identity/.env (moderator@wayfare.test)'

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
as_moderator() { echo "wf_at=$(cat "$work/moderator.at")"; }

login() {
  call "$1-login" 200 -X POST "$BASE/auth/login" "${console[@]}" \
    -d "$(body --arg e "$2" --arg p "$3" '{email: $e, password: $p}')"
  cookie_value "$1-login" wf_at >"$work/$1.at"
}

# start_narration — starts narration with the fake providers and waits for it to be ready.
start_narration() {
  (cd "$repo_root/services/narration" && exec node . >>"$work/narration.log" 2>&1) &
  narration_pid=$!
  local attempt
  for attempt in $(seq 1 50); do
    curl -sS -o /dev/null "$NARRATION_OPS/health/ready" 2>/dev/null && {
      echo '✓ narration ready'
      return
    }
    sleep 0.2
  done
  tail -20 "$work/narration.log"
  fail 'narration did not become ready in 10 s'
}

place_status() { curl -sS "$BASE/admin/places/$1" "${console[@]}" -b "$(admin)" | jq -r .data.status; }
is_active() { [[ $(place_status "$1") == ACTIVE ]]; }
asset_count() { narration_sql 'SELECT count(*) FROM audio_assets'; }
job_count() { narration_sql "SELECT count(*) FROM synthesis_jobs WHERE target_id = '$1' AND trigger = '$2'"; }
newest_job() {
  narration_sql "SELECT id FROM synthesis_jobs WHERE target_id = '$1' ORDER BY created_at DESC, id DESC LIMIT 1"
}
job_is() { [[ $(narration_sql "SELECT status FROM synthesis_jobs WHERE id = '$1'") == "$2" ]]; }
override_status() {
  narration_sql "SELECT status FROM localization_overrides WHERE target_id = '$1' AND lang = '$2' ORDER BY created_at DESC LIMIT 1"
}
ready_source() {
  narration_sql "SELECT payload->>'translationSource' FROM outbox_events
    WHERE subject = 'narration.localization.ready' AND aggregate_id = '$1'
      AND payload->>'lang' = 'en' ORDER BY created_at DESC LIMIT 1"
}
ready_has_audio() {
  narration_sql "SELECT payload ? 'audio' FROM outbox_events
    WHERE subject = 'narration.localization.ready' AND aggregate_id = '$1'
      AND payload->>'lang' = 'en' ORDER BY created_at DESC LIMIT 1"
}

# Conditions for wait_for, re-evaluated on every poll.
dictionary_jobs_at_least() { [[ $(job_count "$1" DICTIONARY_CHANGED) -ge $2 ]]; }
newest_job_done() { [[ $(narration_sql "SELECT status FROM synthesis_jobs WHERE target_id = '$1' ORDER BY created_at DESC, id DESC LIMIT 1") == COMPLETED ]]; }
human_published() { [[ $(ready_source "$1") == HUMAN ]]; }
machine_published() { [[ $(ready_source "$1") == MACHINE ]]; }

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

# entry BODY_JSON NAME EXPECTED — POSTs a dictionary entry as the moderator.
entry() {
  call "$2" "$3" -X POST "$BASE/admin/narration/pronunciations" "${console[@]}" -b "$(as_moderator)" -d "$1"
}

reset_local_state
stamp=$(date +%s)
# The term the walk's dictionary entry is written for: two Places hold it, a third does not. The
# fake translator keeps the Vietnamese words in the English text, so the term is searchable there.
# It carries the run's stamp, so a walk that stopped half-way leaves nothing in the way of the next.
term="Vạn Hoa $stamp"

step '0. seed; sign in as the super admin and the moderator; start narration'
seed_dev
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
login admin "$BOOTSTRAP_SUPER_ADMIN_EMAIL" "$BOOTSTRAP_SUPER_ADMIN_PASSWORD"
login moderator moderator@wayfare.test "$seed_password"
start_narration

step '1. the moderator lists the seeded dictionary'
call list-seeded 200 "$BASE/admin/narration/pronunciations?limit=50" "${console[@]}" -b "$(as_moderator)"
seeded=$(json list-seeded '[.data[] | select(.note | test("development seed"))] | length')
[[ $seeded -ge 12 ]] || fail "the seeded dictionary has $seeded entries, not the 12 seed:dev writes"
[[ $(json list-seeded '[.data[] | select(.term == "Bến Thành" and .targetLang == "en")] | length') == 1 ]] ||
  fail 'the seeded Bến Thành entry is missing'
echo "✓ $seeded seeded entries, each an en SUB sample"

step '2. three Places: two hold the term, one does not'
create_place one 1 "Bảo tàng $term" "Bảo tàng $term mở cửa năm 1920."
create_place two 2 "Nhà trưng bày $term" "Khu $term nằm bên sông."
create_place three 3 "Nhà hát nhỏ $stamp" 'Nhà hát xây năm 1900.'
place_one=$(json create-one .data.place.id)
place_two=$(json create-two .data.place.id)
place_three=$(json create-three .data.place.id)
for id in "$place_one" "$place_two" "$place_three"; do
  wait_for "Place $id is ACTIVE" 60 is_active "$id"
done
echo '✓ three Places live, voiced with the machine translation'

step '3. the dictionary write: a term, its duplicate, and a PHONEME entry with no alphabet'
assets_before=$(asset_count)
entry "$(body --arg t "$term" '{term: $t, targetLang: "en", replacementType: "SUB",
  replacement: "van hwa", note: "walk"}')" create-entry 201
entry_id=$(json create-entry .data.entry.id)
entry "$(body --arg t "$term" '{term: $t, targetLang: "en", replacementType: "SUB",
  replacement: "van hwa again"}')" duplicate 409
[[ $(json duplicate .error.code) == PRONUNCIATION_TERM_EXISTS ]] || fail 'the duplicate is not PRONUNCIATION_TERM_EXISTS'
entry '{"term":"Phú Nhuận","targetLang":"en","replacementType":"PHONEME","replacement":"fu nwun"}' phoneme-no-alphabet 400
[[ $(json phoneme-no-alphabet .error.code) == VALIDATION_FAILED ]] || fail 'a PHONEME entry without an alphabet is not VALIDATION_FAILED'
echo '✓ 201, 409 on the same term and language, 400 for PHONEME without an alphabet'

call patch-entry 200 -X PATCH "$BASE/admin/narration/pronunciations/$entry_id" "${console[@]}" \
  -b "$(as_moderator)" -d '{"replacement":"vahn hwah"}'
[[ $(json patch-entry .data.entry.replacement) == 'vahn hwah' ]] || fail 'the replacement did not change'
entry "$(body --arg t "Tân Định $stamp" '{term: $t, targetLang: "en", replacementType: "SUB",
  replacement: "tan ding"}')" throwaway 201
call delete-entry 204 -X DELETE "$BASE/admin/narration/pronunciations/$(json throwaway .data.entry.id)" \
  "${console[@]}" -b "$(as_moderator)"
echo '✓ PATCH changes a replacement, DELETE removes an entry'

step '4. preview: audio bytes, nothing stored, then the rate class and the length bound'
# The entry's fan-out is already running; it is let finish first, so what the preview writes — and
# it writes nothing — is the only thing the count can move by.
wait_for "the fan-out reached $place_one" 60 dictionary_jobs_at_least "$place_one" 1
wait_for "the fan-out reached $place_two" 60 dictionary_jobs_at_least "$place_two" 1
wait_for "$place_one's fan-out job COMPLETED" 60 newest_job_done "$place_one"
wait_for "$place_two's fan-out job COMPLETED" 60 newest_job_done "$place_two"
preview_before=$(asset_count)
preview_body=$(body --arg t "Bảo tàng $term mở cửa." --arg t2 "$term" '{text: $t, lang: "en",
  entries: [{term: $t2, targetLang: "en", replacementType: "SUB", replacement: "van hwa"}]}')
preview_status=$(curl -sS -o "$work/preview.mp3" -D "$work/preview.h" -w '%{http_code}' \
  -X POST "$BASE/admin/narration/pronunciations/preview" "${console[@]}" -b "$(as_moderator)" -d "$preview_body")
[[ $preview_status == 200 ]] || fail "preview answered HTTP $preview_status"
grep -qi '^content-type: audio/mpeg' "$work/preview.h" || fail 'preview is not audio/mpeg'
grep -qi '^cache-control:.*no-store' "$work/preview.h" || fail 'preview is not no-store'
[[ $(stat -c%s "$work/preview.mp3") -gt 0 ]] || fail 'preview returned no bytes'
echo "✓ preview: $(stat -c%s "$work/preview.mp3") bytes of audio/mpeg, no-store"

long=$(head -c 600 </dev/zero | tr '\0' 'x')
call preview-too-long 400 -X POST "$BASE/admin/narration/pronunciations/preview" "${console[@]}" \
  -b "$(as_moderator)" -d "$(body --arg t "$long" '{text: $t, lang: "en", entries: []}')"
echo '✓ text over the limit → 400'

limited=''
for attempt in $(seq 1 12); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/admin/narration/pronunciations/preview" \
    "${console[@]}" -b "$(as_moderator)" -d "$preview_body")
  [[ $code == 429 ]] && { limited=$attempt; break; }
done
[[ -n $limited ]] || fail 'preview never answered 429 within twelve calls'
echo "✓ preview 429 on call $limited of the minute (PRONUNCIATION_PREVIEW)"
[[ $(asset_count) == "$preview_before" ]] || fail "preview wrote audio assets: $preview_before → $(asset_count)"
echo "✓ still $preview_before audio assets — a preview stores nothing"

step '5. the fan-out: the two Places holding the term are re-voiced, the third is not'
[[ $(job_count "$place_one" DICTIONARY_CHANGED) -ge 1 ]] || fail 'the first Place was not re-voiced'
[[ $(job_count "$place_two" DICTIONARY_CHANGED) -ge 1 ]] || fail 'the second Place was not re-voiced'
[[ $(job_count "$place_three" DICTIONARY_CHANGED) == 0 ]] || fail 'the Place without the term was re-voiced'
assets_after=$(asset_count)
[[ $assets_after -gt $assets_before ]] ||
  fail "the fan-out made no new audio: still $assets_before assets"
echo "✓ two DICTIONARY_CHANGED jobs, none for the third Place, $((assets_after - assets_before)) new audio assets"

# The same entry saved again fans out again; the texts are unchanged, so every task is a cache hit.
jobs_before=$(job_count "$place_one" DICTIONARY_CHANGED)
call resave 200 -X PATCH "$BASE/admin/narration/pronunciations/$entry_id" "${console[@]}" \
  -b "$(as_moderator)" -d '{"note":"walk, saved again"}'
wait_for 'the second fan-out reached the Place' 60 dictionary_jobs_at_least "$place_one" $((jobs_before + 1))
wait_for "$place_one's second fan-out job COMPLETED" 60 newest_job_done "$place_one"
[[ $(asset_count) == "$assets_after" ]] ||
  fail "an identical re-save synthesized again: $assets_after → $(asset_count) assets"
echo "✓ the same entry saved again re-runs the fan-out and reuses every audio asset"

step '6. the correction screen, and an en correction against the current hash'
call overview 200 "$BASE/admin/narration/localizations/PLACE/$place_one" "${console[@]}" -b "$(as_moderator)"
hash=$(json overview .data.sourceContentHash)
[[ $(json overview '[.data.languages[] | select(.lang == "en")] | length') == 1 ]] || fail 'the overview has no en row'
[[ $(json overview '.data.languages[] | select(.lang == "en") | .correction') == null ]] || fail 'en already holds a correction'
echo "✓ the overview lists each language at source hash ${hash:0:12}…"

call correct 200 -X PUT "$BASE/admin/narration/localizations/PLACE/$place_one/en" "${console[@]}" \
  -b "$(as_moderator)" -d "$(body --arg h "$hash" --arg n "Van Hoa Museum $stamp" '{
    sourceContentHash: $h, name: $n, description: "Open since 1920."}')"
[[ $(json correct .data.correction.status) == ACTIVE ]] || fail 'the correction is not ACTIVE'
[[ $(json correct .data.correction.supersededByHash) == false ]] || fail 'a fresh correction is superseded'
[[ $(narration_sql "SELECT trigger FROM synthesis_jobs WHERE id = '$(newest_job "$place_one")'") == HUMAN_EDIT ]] ||
  fail 'the correction queued no HUMAN_EDIT job'
[[ $(place_status "$place_one") == ACTIVE ]] || fail 'the Place left ACTIVE while the correction is voiced'
wait_for "$place_one's HUMAN_EDIT job COMPLETED" 60 job_is "$(newest_job "$place_one")" COMPLETED
wait_for 'the corrected text and its audio are published together' 30 human_published "$place_one"
[[ $(ready_has_audio "$place_one") == t ]] || fail 'the HUMAN localization was published without audio'
call detail-human 200 "$BASE/admin/places/$place_one" "${console[@]}" -b "$(admin)"
echo "✓ 200, an ACTIVE override, a HUMAN_EDIT job, HUMAN text and audio published together"

step '7. a stale hash, and the source language'
call stale 409 -X PUT "$BASE/admin/narration/localizations/PLACE/$place_one/en" "${console[@]}" \
  -b "$(as_moderator)" -d "$(body --arg h "$(printf 'b%.0s' {1..64})" '{sourceContentHash: $h, name: "No"}')"
[[ $(json stale .error.code) == LOCALIZATION_SOURCE_CHANGED ]] || fail 'a stale hash is not LOCALIZATION_SOURCE_CHANGED'
call source-lang 400 -X PUT "$BASE/admin/narration/localizations/PLACE/$place_one/vi" "${console[@]}" \
  -b "$(as_moderator)" -d "$(body --arg h "$hash" '{sourceContentHash: $h, name: "Không"}')"
echo '✓ a stale hash → 409, vi → 400'

step '8. the Vietnamese text moves on: the correction is superseded and the machine text returns'
call edit-vi 200 -X PATCH "$BASE/admin/places/$place_one" "${console[@]}" -b "$(admin)" \
  -d "$(body --arg d "Bảo tàng $term nay mở cả buổi tối." '{descriptionVi: $d}')"
new_hash=$(json edit-vi .data.place.contentHash)
[[ $new_hash != "$hash" ]] || fail 'the edit did not change the content hash'
call overview-moved 200 "$BASE/admin/narration/localizations/PLACE/$place_one" "${console[@]}" -b "$(as_moderator)"
[[ $(json overview-moved .data.sourceContentHash) == "$new_hash" ]] || fail 'the overview still shows the old hash'
[[ $(json overview-moved '.data.languages[] | select(.lang == "en") | .correction.supersededByHash') == true ]] ||
  fail 'the overview does not mark the correction superseded'
wait_for "the edit's job COMPLETED" 60 newest_job_done "$place_one"
wait_for 'the machine translation is published again' 30 machine_published "$place_one"
[[ $(override_status "$place_one" en) == REVERTED ]] ||
  fail "the stale override is $(override_status "$place_one" en), not REVERTED"
echo '✓ superseded on the overview, retired by the task, machine translation published'

step '9. a correction for the new text, then a revert'
call correct-again 200 -X PUT "$BASE/admin/narration/localizations/PLACE/$place_one/en" "${console[@]}" \
  -b "$(as_moderator)" -d "$(body --arg h "$new_hash" --arg n "Van Hoa Museum $stamp" '{
    sourceContentHash: $h, name: $n, description: "Open since 1920, evenings too."}')"
wait_for 'the new correction is voiced' 60 job_is "$(newest_job "$place_one")" COMPLETED
wait_for 'the corrected text is published' 30 human_published "$place_one"
call revert 204 -X DELETE "$BASE/admin/narration/localizations/PLACE/$place_one/en" "${console[@]}" -b "$(as_moderator)"
[[ $(override_status "$place_one" en) == REVERTED ]] || fail 'the reverted override is not REVERTED'
[[ $(narration_sql "SELECT trigger FROM synthesis_jobs WHERE id = '$(newest_job "$place_one")'") == HUMAN_REVERT ]] ||
  fail 'the revert queued no HUMAN_REVERT job'
wait_for "the revert's job COMPLETED" 60 job_is "$(newest_job "$place_one")" COMPLETED
wait_for 'the machine translation is published with its audio' 30 machine_published "$place_one"
[[ $(ready_has_audio "$place_one") == t ]] || fail 'the machine localization came back without audio'
call revert-twice 404 -X DELETE "$BASE/admin/narration/localizations/PLACE/$place_one/en" "${console[@]}" -b "$(as_moderator)"
echo '✓ REVERTED, a HUMAN_REVERT job, machine text and audio published, a second revert → 404'

step 'done'
call cleanup-entry 204 -X DELETE "$BASE/admin/narration/pronunciations/$entry_id" "${console[@]}" -b "$(as_moderator)"
printf '\n✓ walk-pronunciation: every step passed\n'
