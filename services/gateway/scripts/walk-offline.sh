#!/usr/bin/env bash
# Live walk of offline mode's server half against a running stack (identity, catalog, narration
# with the fake providers, billing, gateway, NATS, Redis, fake-gcs): a map pack built by
# `pnpm tiles:build` is registered — every object re-hashed — and published; its archive answers
# range reads from the bucket; a device's manifest lists every asset with a hash that matches what
# the bucket serves, the second time from the cache; after an edit, the diff lists only what
# changed; favourites follow an account across two devices. Uses http://localhost only.
#
# Usage: services/gateway/scripts/walk-offline.sh
#   Needs `pnpm seed:dev` run once, SEED_ACCOUNT_PASSWORD in services/identity/.env (the
#   Vĩnh Khánh owners) and `pnpm tiles:build --area hcmc-d1-core` run first — the walk registers
#   the body it wrote. BASE, ROOT and CATALOG_METRICS may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
CATALOG_METRICS=${CATALOG_METRICS:-http://localhost:9102/metrics}
APP_VERSION=${APP_VERSION:-1.0.0}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
cleanup() {
  # Best-effort: the archive is restored if a failure left it overwritten; the walk's Place goes.
  [[ -n ${archive_file:-} ]] && upload_file "$archive_file" "$archive_path" 2>/dev/null || true
  forget_places
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"
mobile=(-H 'x-wayfare-client: mobile' -H "x-wayfare-app-version: $APP_VERSION" -H 'content-type: application/json')

seed_password=$(grep -E '^SEED_ACCOUNT_PASSWORD=.+' "$repo_root/services/identity/.env" | cut -d= -f2- || true)
[[ -n $seed_password ]] || fail 'set SEED_ACCOUNT_PASSWORD in services/identity/.env (the Vĩnh Khánh owners)'
build=$repo_root/infra/tiles/.cache/build/hcmc-d1-core
[[ -f $build/register.json ]] || fail 'run `pnpm tiles:build --area hcmc-d1-core` first'
media_base=$(grep -E '^GCS_PUBLIC_BASE_URL=' "$repo_root/services/catalog/.env" | cut -d= -f2-)
media_api=$(grep -E '^GCS_API_ENDPOINT=' "$repo_root/services/catalog/.env" | cut -d= -f2-)
media_bucket=$(grep -E '^GCS_BUCKET_MEDIA=' "$repo_root/services/catalog/.env" | cut -d= -f2-)

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
bearer() { echo "authorization: Bearer $(cat "$work/$1.token")"; }
# upload_file FILE PATH — writes one object to the media bucket, as the build's upload did.
upload_file() {
  curl -sS -o /dev/null -f -X POST --data-binary "@$1" -H 'content-type: application/octet-stream' \
    "$media_api/upload/storage/v1/b/$media_bucket/o?uploadType=media&name=$(jq -rn --arg p "$2" '$p | @uri')"
}
sha_of_url() { curl -sSf "$1" | sha256sum | cut -d' ' -f1; }
cache_hits() {
  curl -sS "$CATALOG_METRICS" | awk '/^offline_manifest_cache_total\{result="hit"\}/ { print $2 }' | tail -1
}
place_status() { curl -sS "$BASE/admin/places/$1" "${console[@]}" -b "$(admin)" | jq -r .data.status; }
place_is() { [[ $(place_status "$1") == "$2" ]]; }
register_device() {
  call "$1-register" 201 -X POST "$BASE/devices" "${mobile[@]}" \
    -d '{"platform":"ANDROID","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'
  json "$1-register" .data.accessToken >"$work/$1.token"
  json "$1-register" .data.deviceId >"$work/$1.id"
}

reset_local_state
stamp=$(date +%s)
area_id=$(pilot_area_id)

step '0. the bucket, the super admin, a device, and this run’s Place'
(cd "$repo_root" && pnpm --silent --filter @wayfare/catalog storage:setup) | tail -2
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
register_device phone
# create_place INDEX — an Editorial Place of this run, activated; prints its id.
create_place() {
  local lat lng
  read -r lat lng < <(walk_location "$1")
  call "create-$1" 201 -X POST "$BASE/admin/places" "${console[@]}" -b "$(admin)" -d "$(body \
    --arg name "Điểm ngoại tuyến $stamp-$1" --argjson lat "$lat" --argjson lng "$lng" '{
      nameVi: $name,
      descriptionVi: "Một điểm thử của bài đi bộ ngoại tuyến, xóa khi bài kết thúc.",
      categoryCode: "LANDMARK",
      location: {lat: $lat, lng: $lng},
      triggerRadiusM: 40,
      narrationPriority: 50,
      photos: [],
      openingHours: [],
      requestActivation: true
    }')" >&2
  remember_place "$(json "create-$1" .data.place.id)"
  json "create-$1" .data.place.id
}
place_id=$(create_place 0)
other_id=$(create_place 1)
both_active() { place_is "$place_id" ACTIVE && place_is "$other_id" ACTIVE; }
wait_for "this run's two Places are ACTIVE (narration answered)" 90 both_active

step '1. register the built pack; an overwritten archive → 422; a path outside the build → 400'
cp "$build/register.json" "$work/pack-body.json"
archive_path=$(jq -r .pmtiles.path "$work/pack-body.json")
call register 201 -X POST "$BASE/admin/map-packs" "${console[@]}" -b "$(admin)" --data-binary "@$work/pack-body.json"
pack_id=$(json register .data.mapPack.id)
pack_version=$(json register .data.mapPack.version)
[[ $(json register .data.mapPack.status) == BUILDING ]] || fail 'the pack is not BUILDING'
echo "✓ version $pack_version, $(json register '.data.mapPack.assets | length') assets, $(json register .data.mapPack.totalBytes) bytes"
head -c 4096 /dev/urandom >"$work/garbage.bin"
archive_file=$build/map.pmtiles
upload_file "$work/garbage.bin" "$archive_path"
call register-tampered 422 -X POST "$BASE/admin/map-packs" "${console[@]}" -b "$(admin)" \
  --data-binary "@$work/pack-body.json"
[[ $(json register-tampered .error.code) == MAP_PACK_HASH_MISMATCH ]] || fail 'not MAP_PACK_HASH_MISMATCH'
[[ $(json register-tampered .error.details.path) == "$archive_path" ]] || fail 'not the archive'
upload_file "$archive_file" "$archive_path"
archive_file=''
echo '✓ MAP_PACK_HASH_MISMATCH { path: the archive }; the archive restored'
call register-outside 400 -X POST "$BASE/admin/map-packs" "${console[@]}" -b "$(admin)" \
  -d "$(jq -c '.style.path = "photos/walk/style.json"' "$work/pack-body.json")"
echo "✓ $(json register-outside '.error.details.issues[0] | "\(.path) \(.code)"')"

step '2. publish → GET /areas shows the version and size'
call publish 200 -X POST "$BASE/admin/map-packs/$pack_id/publish" "${console[@]}" -b "$(admin)"
[[ $(json publish .data.mapPack.status) == PUBLISHED ]] || fail 'the pack is not PUBLISHED'
call areas 200 "$BASE/areas" -H 'x-wayfare-client: console'
[[ $(json areas ".data[] | select(.id == \"$area_id\") | .mapPack.version") == "$pack_version" ]] ||
  fail 'GET /areas does not show the published version'
echo "✓ GET /areas: mapPack $(json areas ".data[] | select(.id == \"$area_id\") | .mapPack")"
call register-2 201 -X POST "$BASE/admin/map-packs" "${console[@]}" -b "$(admin)" --data-binary "@$work/pack-body.json"
call publish-2 200 -X POST "$BASE/admin/map-packs/$(json register-2 .data.mapPack.id)/publish" "${console[@]}" -b "$(admin)"
call packs 200 "$BASE/admin/map-packs?areaId=$area_id" "${console[@]}" -b "$(admin)"
[[ $(json packs "[.data[] | select(.id == \"$pack_id\")][0].status") == RETIRED ]] || fail 'the first pack is not RETIRED'
pack_version=$(json register-2 .data.mapPack.version)
echo "✓ a second publish (version $pack_version) retired the first"

step '3. a range read of the archive, straight from the bucket'
archive_url=$media_base/$archive_path
curl -sS -r 0-1023 -o "$work/range.bin" -D "$work/range.h" "$archive_url"
grep -q '^HTTP/1.1 206' "$work/range.h" || fail "no 206: $(head -1 "$work/range.h")"
grep -qi '^accept-ranges: bytes' "$work/range.h" || fail 'no Accept-Ranges'
[[ $(stat -c %s "$work/range.bin") == 1024 ]] || fail 'not 1024 bytes'
echo '✓ 206 Partial Content, Accept-Ranges: bytes, 1024 bytes'

step '4. the en manifest: every asset downloaded and checked; the second call from the cache'
# The manifest is taken at delta sync's cap, which trails writes by the sync lag: this run's Place
# is in it once it has settled.
settled() {
  curl -sS -o "$work/manifest.json" "$BASE/offline/areas/$area_id/manifest?lang=en" "${mobile[@]}" -H "$(bearer phone)"
  jq -e --arg id "$place_id" '[.data.audio[] | select(.placeId == $id)] | length == 1' "$work/manifest.json" >/dev/null
}
wait_for "the manifest holds this run's Place (past the sync lag)" 20 settled
call manifest 200 "$BASE/offline/areas/$area_id/manifest?lang=en" "${mobile[@]}" -H "$(bearer phone)"
[[ $(json manifest .data.mapPack.version) == "$pack_version" ]] || fail 'not the published pack'
json manifest '[.data.places, .data.mapPack.pmtiles, .data.mapPack.style] + .data.mapPack.assets + .data.photos + .data.audio | .[] | "\(.url) \(.sha256) \(.bytes)"' >"$work/assets.txt"
total=0
while read -r url sha bytes; do
  [[ $(sha_of_url "$url") == "$sha" ]] || fail "$url does not hash to its sha256"
  total=$((total + bytes))
done <"$work/assets.txt"
[[ $total == "$(json manifest .data.totalBytes)" ]] || fail "totalBytes is not the sum ($total)"
[[ $(json manifest "[.data.audio[] | select(.placeId == \"$place_id\")] | length") == 1 ]] ||
  fail "this run's Place has no en audio in the manifest"
curl -sS "$(json manifest .data.places.url)" | gunzip | jq -e --arg id "$place_id" 'select(.id == $id)' >/dev/null ||
  fail "the snapshot does not hold this run's Place"
echo "✓ $(wc -l <"$work/assets.txt") assets, every hash matches, $total bytes; the snapshot holds this run's Place"
hits_before=$(cache_hits || echo 0)
call manifest-again 200 "$BASE/offline/areas/$area_id/manifest?lang=en" "${mobile[@]}" -H "$(bearer phone)"
[[ $(awk -v a="${hits_before:-0}" -v b="$(cache_hits)" 'BEGIN { print (b > a) }') == 1 ]] ||
  fail 'offline_manifest_cache_total{result="hit"} did not rise'
echo "✓ offline_manifest_cache_total{result=\"hit\"}: ${hits_before:-0} → $(cache_hits)"
from_version=$(json manifest .data.datasetVersion)

step '5. edit the Place, wait for ACTIVE, then the diff from the manifest'
call edit 200 -X PATCH "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)" \
  -d '{"descriptionVi":"Một điểm thử của bài đi bộ ngoại tuyến, nay có mô tả mới."}'
wait_for 'the edited Place is ACTIVE again' 90 place_is "$place_id" ACTIVE
diff_ready() {
  curl -sS -o "$work/diff.json" "$BASE/offline/areas/$area_id/manifest/diff?lang=en&fromDatasetVersion=$from_version&fromMapPackVersion=$pack_version" \
    "${mobile[@]}" -H "$(bearer phone)"
  jq -e --arg id "$place_id" '.data.changedPlaceIds | index($id) != null' "$work/diff.json" >/dev/null
}
wait_for 'the diff lists the edited Place (past the sync lag)' 15 diff_ready
jq -e '.data.mapPack == null and .data.drop == []' "$work/diff.json" >/dev/null || fail 'the diff carries a map'
jq -e --arg id "$place_id" '[.data.audio[] | select(.placeId == $id)] | length == 1' "$work/diff.json" >/dev/null ||
  fail 'the diff lacks the new audio'
echo "✓ diff: changed $(jq -c .data.changedPlaceIds "$work/diff.json"), removed $(jq -c .data.removedPlaceIds "$work/diff.json"), $(jq '.data.audio | length' "$work/diff.json") audio, no map"

step '6. favourites across two devices of one account'
favorite_a=$place_id
favorite_b=$other_id
register_device tablet
call fav-a 204 -X PUT "$BASE/me/favorites/$favorite_a" "${mobile[@]}" -H "$(bearer phone)"
call fav-a-again 204 -X PUT "$BASE/me/favorites/$favorite_a" "${mobile[@]}" -H "$(bearer phone)"
[[ $(catalog_sql "SELECT count(*) FROM favorites WHERE device_id = '$(cat "$work/phone.id")'") == 1 ]] ||
  fail 'PUT twice made two rows'
echo '✓ PUT twice → one row'
owner_email=$(jq -r '.owners[] | select(.slug == "owner-1") | .email' "$repo_root/services/identity/prisma/seed/pilot-d4/owners.json")
for device in phone tablet; do
  call "$device-login" 200 -X POST "$BASE/auth/login" "${mobile[@]}" -H "$(bearer "$device")" \
    -d "$(body --arg e "$owner_email" --arg p "$seed_password" '{email: $e, password: $p}')"
  json "$device-login" .data.accessToken >"$work/$device-account.token"
done
favorites_of() { curl -sS "$BASE/me/favorites?lang=en" "${mobile[@]}" -H "$(bearer "$1")" | jq -c '[.data[].placeId] | sort'; }
has() { [[ $(favorites_of "$1") == "$2" ]]; }
wait_for "the tablet sees the phone's favourite once the phone is claimed" 10 \
  has tablet-account "[\"$favorite_a\"]"
call fav-b 204 -X PUT "$BASE/me/favorites/$favorite_b" "${mobile[@]}" -H "$(bearer tablet-account)"
expected=$(jq -nc --arg a "$favorite_a" --arg b "$favorite_b" '[$a, $b] | sort')
has phone-account "$expected" || fail "the phone does not see the tablet's new favourite at once"
echo "✓ the phone sees the tablet's favourite saved after the claim, at once"
call unfav-a 204 -X DELETE "$BASE/me/favorites/$favorite_a" "${mobile[@]}" -H "$(bearer tablet-account)"
has phone-account "[\"$favorite_b\"]" || fail 'a removal on the tablet reappears on the phone'
echo '✓ removed on the tablet, gone from the phone'
call forget-tablet 204 -X DELETE "$BASE/devices/me" "${mobile[@]}" -H "$(bearer tablet)"
tablet_rows() { [[ $(catalog_sql "SELECT count(*) FROM favorites WHERE device_id = '$(cat "$work/tablet.id")'") == 0 ]]; }
wait_for "forgetting the tablet drops its rows" 10 tablet_rows
call forget-phone 204 -X DELETE "$BASE/devices/me" "${mobile[@]}" -H "$(bearer phone)"

printf '\n✓ offline walk complete\n'
