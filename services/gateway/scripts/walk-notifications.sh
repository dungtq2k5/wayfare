#!/usr/bin/env bash
# Live walk of the notification feed against a running stack (identity, catalog, gateway, NATS,
# Redis): an admin's edits and a Venue's status changes reach the owner's two open console tabs,
# and reading on one tab clears the other. Uses http://localhost only: curl never sends a Secure
# cookie to 127.0.0.1. narration may run or not: the walk never changes a Place's text.
#
# Usage: services/gateway/scripts/walk-notifications.sh
#   BASE, ROOT and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden. The Venue is inserted
#   by SQL (owner registration and submissions come later) and deleted by SQL at the end: deleting
#   a Venue through catalog needs billing, which fails closed until it exists.
set -euo pipefail

ROOT=${ROOT:-http://localhost:3000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
# retire_venue — soft-deletes the walk Venue with a sync bump, as a delete would. By SQL: catalog
# refuses to delete a Venue while billing cannot say it has no live vouchers (fail-closed).
retire_venue() {
  [[ -n ${venue_id:-} ]] || return 0
  catalog_sql "UPDATE places SET deleted_at = clock_timestamp(), updated_at = clock_timestamp(),
      sync_version = nextval('catalog_sync_version_seq')
    WHERE id = '$venue_id' AND deleted_at IS NULL" >/dev/null || true
}

cleanup() {
  retire_venue
  for pid in "${socket_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
owner() { echo "wf_at=$(cat "$work/owner.at")"; }

# count_of NAME — how many frames of `notification:new` socket NAME has received.
news() { frames "$1" '[.[] | select(.event == "notification:new")] | length'; }
# last_count NAME — the last unread count socket NAME was told.
last_count() { frames "$1" '[.[] | select(.event == "notification:unread-count")][-1].payload.count'; }
news_at_least() { [[ $(news "$1") -ge $2 ]]; }
count_is() { [[ $(last_count "$1") == "$2" ]]; }
read_frames() { frames "$1" '[.[] | select(.event == "notification:read")] | length'; }
read_frames_at_least() { [[ $(read_frames "$1") -ge $2 ]]; }
has_type() { [[ $(frames "$1" "[.[] | select(.event == \"notification:new\" and .payload.type == \"$2\")] | length") -ge 1 ]]; }

# edit_phone N — an admin edit that changes only the phone: never the text, so never narration.
edit_phone() {
  call "edit-$1" 200 -X PATCH "$BASE/admin/places/$venue_id" "${console[@]}" -b "$(admin)" \
    -d "$(body --arg phone "+8428382900$1" '{phone: $phone}')"
}

reset_local_state
stamp=$(date +%s)

step '1. an owner-to-be on the console, and the super admin'
seed_dev
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
call owner-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d '{"email":"walk-owner-'"$stamp"'@example.com","password":"correct horse battery","preferredLocale":"vi","termsVersion":"2026-09-01"}'
cookie_value owner-register wf_at >"$work/owner.at"
owner_id=$(json owner-register .data.user.id)
echo "✓ owner $owner_id"

step '2. an ACTIVE Venue the owner holds, with ready vi and en rows (inserted by SQL)'
read -r lat lng < <(walk_location 3)
name="Quán thử $stamp"
description='Một quán thử của bài đi bộ, xóa khi bài kết thúc.'
venue_id=$(catalog_node 'process.stdout.write(require("@wayfare/contracts").newId())')
hash=$(catalog_node '
  const { contentHash } = require("@wayfare/nest-common");
  process.stdout.write(contentHash({ name: process.argv[1], description: process.argv[2] }));' "$name" "$description")
code=$(printf 'W%07d' $((stamp % 10000000)))
catalog_sql "INSERT INTO places (
    id, kind, owner_user_id, public_code, category_id, area_id, name_vi, description_vi, content_hash,
    location, auto_narration_enabled, discovery_boost, status, activation_requested_at, published_at,
    sync_version, created_by_id, updated_at)
  SELECT '$venue_id', 'VENUE', '$owner_id', '$code', c.id, '$(pilot_area_id)', '$name', '$description',
    '$hash', ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography, true, 0, 'ACTIVE', now(), now(),
    nextval('catalog_sync_version_seq'), '$owner_id', now()
  FROM categories c WHERE c.code = 'RESTAURANT'" >/dev/null
for lang in vi en; do
  catalog_sql "INSERT INTO place_localizations (place_id, lang, name, description, source_content_hash,
      translation_source, audio_status, audio_source_content_hash, audio_object_path, audio_sha256,
      audio_bytes, audio_duration_ms)
    VALUES ('$venue_id', '$lang', '$name', '$description', '$hash',
      '$([[ $lang == vi ]] && echo SOURCE || echo MACHINE)', 'READY', '$hash',
      'audio/$hash-$lang.mp3', '$(printf 'e%.0s' {1..64})', 1000, 2000)" >/dev/null
done
echo "✓ Venue $venue_id at $lat, $lng"

step '3. two console tabs for the owner'
socket tab-a "$(cat "$work/owner.at")"
socket tab-b "$(cat "$work/owner.at")"
wait_for 'tab A is ready' 5 saw tab-a connection:ready
wait_for 'tab B is ready' 5 saw tab-b connection:ready

step '4. an admin edit reaches both tabs within a second'
edit_phone 1
wait_for 'tab A received notification:new' 1 news_at_least tab-a 1
wait_for 'tab B received notification:new' 1 news_at_least tab-b 1
wait_for 'both tabs count 1' 2 count_is tab-b 1
[[ $(frames tab-a '[.[] | select(.event == "notification:new")][0].payload.type') == '"PLACE_EDITED_BY_ADMIN"' ]] ||
  fail 'the notification is not PLACE_EDITED_BY_ADMIN'

step '5. the feed reads back'
call feed 200 "$BASE/notifications" "${console[@]}" -b "$(owner)"
[[ $(json feed '.data | length') == 1 && $(json feed '.data[0].readAt') == null ]] || fail "feed: $(jq -c .data "$work/feed.json")"
[[ $(json feed '.data[0] | keys | join(",")') == 'createdAt,data,id,readAt,type' ]] || fail 'a feed row has other fields'
notification_id=$(json feed '.data[0].id')
call feed-unread 200 "$BASE/notifications?unreadOnly=true" "${console[@]}" -b "$(owner)"
[[ $(json feed-unread '.data | length') == 1 ]] || fail 'the unread feed does not list it'
call count 200 "$BASE/notifications/unread-count" "${console[@]}" -b "$(owner)"
[[ $(json count .data.count) == 1 ]] || fail 'the count is not 1'

step '6. reading on tab A clears tab B; reading again is 204 with no frame'
call read 204 -X POST "$BASE/notifications/$notification_id/read" "${console[@]}" -b "$(owner)"
wait_for 'tab B received notification:read { ids }' 2 read_frames_at_least tab-b 1
[[ $(frames tab-b '[.[] | select(.event == "notification:read")][0].payload.ids[0]') == "\"$notification_id\"" ]] ||
  fail 'the read frame does not name the notification'
wait_for 'tab B counts 0' 2 count_is tab-b 0
call read-again 204 -X POST "$BASE/notifications/$notification_id/read" "${console[@]}" -b "$(owner)"
sleep 1
[[ $(read_frames tab-b) == 1 ]] || fail 'a repeated read sent a frame'
echo '✓ a repeated read sends nothing'

step '7. two more edits, then read-all'
edit_phone 2
edit_phone 3
wait_for 'tab B counts 2' 3 count_is tab-b 2
call read-all 204 -X POST "$BASE/notifications/read-all" "${console[@]}" -b "$(owner)"
wait_for 'tab B received notification:read { all }' 2 read_frames_at_least tab-b 2
[[ $(frames tab-b '[.[] | select(.event == "notification:read")][-1].payload') == '{"all":true}' ]] ||
  fail 'read-all did not send { all: true }'
wait_for 'tab B counts 0 again' 2 count_is tab-b 0

step '8. deactivate and reactivate the Venue'
call deactivate 200 -X POST "$BASE/admin/places/$venue_id/deactivate" "${console[@]}" -b "$(admin)" \
  -d '{"reason":"Walk: a temporary closure"}'
wait_for 'the owner is told PLACE_UNPUBLISHED' 3 has_type tab-a PLACE_UNPUBLISHED
[[ $(frames tab-a '[.[] | select(.payload.type == "PLACE_UNPUBLISHED")][0].payload.data.reason') == '"ADMIN"' ]] ||
  fail 'PLACE_UNPUBLISHED does not carry the ADMIN reason'
call activate 200 -X POST "$BASE/admin/places/$venue_id/activate" "${console[@]}" -b "$(admin)"
[[ $(json activate .data.status) == ACTIVE ]] || fail "the Venue is $(json activate .data.status), not ACTIVE"
wait_for 'the owner is told PLACE_ACTIVATED' 3 has_type tab-a PLACE_ACTIVATED

step '9. delete the Venue again'
retire_venue
[[ $(catalog_sql "SELECT count(*) FROM places WHERE id = '$venue_id' AND deleted_at IS NULL") == 0 ]] ||
  fail 'the walk Venue is still live'
echo '✓ the walk Venue is deleted'

printf '\n✓ notifications walk complete\n'
