#!/usr/bin/env bash
# Live walk of Place administration and the tourist reads against a running stack (identity,
# catalog, gateway, fake-gcs, NATS), started from the repository root's compose file.
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# narration must be STOPPED: this walk plays narration's part itself, asserting the gate before
# publishing hand-made `ready` events, and a running pipeline would deliver real ones first.
#
# Usage: services/gateway/scripts/walk-catalog.sh
#   BASE, ROOT, NARRATION_OPS and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden. Step 0
#   runs `pnpm seed:dev`; the Place is created in the seeded pilot area and deleted at the end. The
#   sync lag makes some steps wait ~6 s.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
GCS=${GCS:-http://localhost:4443}
BUCKET=${BUCKET:-wayfare-media-local}
APP_VERSION=${APP_VERSION:-1.0.0}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
NARRATION_OPS=${NARRATION_OPS:-http://localhost:3103}
work=$(mktemp -d)
trap 'forget_places; rm -rf "$work"' EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

mobile=(-H 'x-wayfare-client: mobile' -H "x-wayfare-app-version: $APP_VERSION" -H 'content-type: application/json')
web=(-H 'x-wayfare-client: web')
LAG_WAIT=6

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
device() { echo "authorization: Bearer $(cat "$work/device.token")"; }

# sync NAME SINCE — a delta page as the device, after the lag has passed.
sync() {
  call "$1" 200 "$BASE/sync/places?areaId=$area_id&lang=en&since=$2" "${mobile[@]}" -H "$(device)"
}

# wait_for_status STATUS — polls the console until the Place has it (the consumer is async).
wait_for_status() {
  local attempt status
  for attempt in $(seq 1 50); do
    status=$(curl -sS "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)" | jq -r .data.status)
    [[ $status == "$1" ]] && { echo "✓ the Place is $1"; return; }
    sleep 0.2
  done
  fail "the Place is $status, not $1, after 10 s"
}

# upload NAME FILE — signs, PUTs and confirms a JPEG; prints nothing, leaves $work/NAME-confirm.json.
upload() {
  local name=$1 file=$2 bytes url
  bytes=$(stat -c %s "$file")
  call "$name-sign" 201 -X POST "$BASE/uploads" "${console[@]}" -b "$(admin)" \
    -d "$(body --argjson b "$bytes" '{purpose: "PLACE_PHOTO", contentType: "image/jpeg", bytes: $b}')"
  url=$(json "$name-sign" .data.uploadUrl)
  local headers=()
  while IFS= read -r line; do headers+=(-H "$line"); done < <(json "$name-sign" '.data.requiredHeaders | to_entries[] | "\(.key): \(.value)"')
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "${headers[@]}" --data-binary "@$file" "$url")
  [[ $status == 200 ]] || fail "$name: the signed PUT answered $status"
  echo "✓ $name: PUT to storage"
  call "$name-confirm" 200 -X POST "$BASE/uploads/$(json "$name-sign" .data.uploadId)/confirm" \
    "${console[@]}" -b "$(admin)"
}

# A phone photo: a GPS position in its EXIF.
make_photo() {
  catalog_node '
    const sharp = require("sharp");
    const [out, shade] = process.argv.slice(1);
    sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: Number(shade), g: 90, b: 40 } } })
      .jpeg()
      .withExif({ IFD0: { Make: "WalkPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 46/1 21/1" } })
      .toFile(out)
      .catch((error) => { console.error(error); process.exit(1); });' "$1" "$2"
}

reset_local_state
stamp=$(date +%s)

step '0. narration stopped; seed; sign in and register a device'
if curl -sS -o /dev/null -m 2 "$NARRATION_OPS/health" 2>/dev/null; then
  fail "narration answers at $NARRATION_OPS — stop it first: this walk publishes narration's events itself"
fi
echo '✓ narration is stopped'
seed_dev
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
call device-register 201 -X POST "$BASE/devices" "${mobile[@]}" \
  -d '{"platform":"ANDROID","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'
json device-register .data.accessToken >"$work/device.token"
area_id=$(pilot_area_id)
read -r walk_lat walk_lng < <(walk_location 0)
echo "✓ pilot area $area_id; this run's Place at $walk_lat, $walk_lng"

step '1. the public reads'
call categories 200 "$BASE/categories" "${web[@]}"
[[ $(json categories '[.data[] | select(.code == "LANDMARK")] | length') == 1 ]] || fail 'LANDMARK is not listed'
grep -qi '^cache-control: public, max-age=300' "$work/categories.h" || fail '/categories is not publicly cacheable'
call areas 200 "$BASE/areas" "${web[@]}"
[[ $(json areas ".data[] | select(.id == \"$area_id\") | .boundary.type") == Polygon ]] ||
  fail 'the area is not listed with a GeoJSON boundary'

step '2. upload a GPS-tagged JPEG; the variants carry no EXIF and the original is gone'
make_photo "$work/photo-1.jpg" 200
upload photo-1 "$work/photo-1.jpg"
upload_1=$(json photo-1-confirm .data.uploadId)
card_url=$(json photo-1-confirm .data.variants.card.url)
curl -sS -o "$work/card.webp" "$card_url"
catalog_node '
  const sharp = require("sharp");
  sharp(process.argv[1]).metadata().then((m) => {
    if (m.format !== "webp" || m.exif !== undefined) { console.error("✗ the card variant kept metadata"); process.exit(1); }
    console.log(`✓ card variant: ${m.width}×${m.height} WebP, no EXIF`);
  });' "$work/card.webp"
if grep -q WalkPhone "$work/card.webp"; then fail 'the camera make survived'; fi
status=$(curl -sS -o /dev/null -w '%{http_code}' "$GCS/storage/v1/b/$BUCKET/o/uploads%2F$upload_1%2Foriginal")
[[ $status == 404 ]] || fail "the original is still stored (HTTP $status)"
echo '✓ the original is deleted'

step '3. create an Editorial Place with the photo, hours and requestActivation → PROCESSING'
call create 201 -X POST "$BASE/admin/places" "${console[@]}" -b "$(admin)" -d "$(body \
  --arg name "Điểm thử $stamp" --arg upload "$upload_1" \
  --argjson lat "$walk_lat" --argjson lng "$walk_lng" '{
    nameVi: $name,
    descriptionVi: "Một điểm thử của bài đi bộ, xóa khi bài kết thúc.",
    categoryCode: "LANDMARK",
    location: {lat: $lat, lng: $lng},
    addressVi: "7 Công Trường Lam Sơn",
    triggerRadiusM: 40,
    narrationPriority: 70,
    photos: [{uploadId: $upload, altTextVi: "Mặt tiền"}],
    openingHours: [{weekday: 1, opensAt: "09:00", closesAt: "17:00"}, {specificDate: "2027-02-06", isClosed: true}],
    requestActivation: true
  }')"
place_id=$(json create .data.place.id)
remember_place "$place_id"
code=$(json create .data.place.publicCode)
hash=$(json create .data.place.contentHash)
[[ $(json create .data.place.status) == PROCESSING ]] || fail 'the Place is not PROCESSING'
[[ $(json create .data.place.areaId) == "$area_id" ]] || fail 'the Place is not in the pilot area'
echo "✓ Place $place_id, code $code"

step '4. activate → the gate says what is missing'
call activate 200 -X POST "$BASE/admin/places/$place_id/activate" "${console[@]}" -b "$(admin)"
gate=$(jq -c .data "$work/activate.json")
[[ $gate == '{"status":"PROCESSING","missing":["en.text","en.audio"]}' ]] || fail "unexpected gate answer: $gate"

step '5. the device does not see it'
sleep "$LAG_WAIT"
sync sync-empty 0
[[ $(json sync-empty "[.data.places[] | select(.id == \"$place_id\")] | length") == 0 ]] || fail 'a PROCESSING Place was synced'
version_0=$(json sync-empty .data.datasetVersion)

step '6. narration reports vi, then en with audio → ACTIVE, and synced'
publish narration.localization.ready "$(ready_event "$place_id" vi "$hash")"
publish narration.localization.ready "$(ready_event "$place_id" en "$hash")"
wait_for_status ACTIVE
sleep 1
outbox_status=$(catalog_sql "SELECT count(*) FROM outbox_events WHERE subject = 'catalog.place.status_changed' AND aggregate_id = '$place_id' AND payload->>'to' = 'ACTIVE' AND published_at IS NOT NULL")
[[ $outbox_status == 1 ]] || fail 'catalog.place.status_changed was not published'
echo '✓ catalog.place.status_changed published'
sleep "$LAG_WAIT"
sync sync-live "$version_0"
[[ $(json sync-live "[.data.places[] | select(.id == \"$place_id\")] | .[0].localization.contentTier") == REQUESTED ]] ||
  fail 'the live Place is not synced in English'
[[ $(json sync-live "[.data.places[] | select(.id == \"$place_id\")] | .[0].localization.audio != null") == true ]] ||
  fail 'the synced Place has no audio'
version_1=$(json sync-live .data.datasetVersion)
etag=$(grep -i '^etag:' "$work/sync-live.h" | cut -d' ' -f2- | tr -d '\r')
status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/sync/places?areaId=$area_id&lang=en&since=$version_0" \
  "${mobile[@]}" -H "$(device)" -H "if-none-match: $etag")
[[ $status == 304 ]] || fail "a current ETag answered $status"
echo '✓ If-None-Match → 304'

step '7. a description edit → PROCESSING and a new content_changed; then en for the new hash → ACTIVE'
before=$(catalog_sql "SELECT count(*) FROM outbox_events WHERE subject = 'catalog.place.content_changed' AND aggregate_id = '$place_id'")
call edit 200 -X PATCH "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)" \
  -d '{"descriptionVi":"Nhà hát xây năm 1900, nay là nơi biểu diễn nghệ thuật."}'
[[ $(json edit .data.place.status) == PROCESSING ]] || fail 'the edit did not close the gate'
new_hash=$(json edit .data.place.contentHash)
after=$(catalog_sql "SELECT count(*) FROM outbox_events WHERE subject = 'catalog.place.content_changed' AND aggregate_id = '$place_id'")
[[ $after == $((before + 1)) ]] || fail "content_changed rows went from $before to $after"
echo '✓ a new catalog.place.content_changed'
sleep "$LAG_WAIT"
sync sync-hidden "$version_1"
[[ $(json sync-hidden "[.data.removedPlaceIds[] | select(. == \"$place_id\")] | length") == 1 ]] ||
  fail 'the Place is not listed as removed'
version_2=$(json sync-hidden .data.datasetVersion)
publish narration.localization.ready "$(ready_event "$place_id" en "$new_hash")"
wait_for_status ACTIVE

step '8. a photo replace keeps it ACTIVE and bumps the sync version'
call before-photos 200 "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)"
version_before=$(json before-photos .data.syncVersion)
photo_1=$(json before-photos '.data.photos[0].id')
make_photo "$work/photo-2.jpg" 60
upload photo-2 "$work/photo-2.jpg"
call photos 200 -X PUT "$BASE/admin/places/$place_id/photos" "${console[@]}" -b "$(admin)" \
  -d "$(body --arg kept "$photo_1" --arg added "$(json photo-2-confirm .data.uploadId)" \
    '{items: [{uploadId: $added}, {photoId: $kept}]}')"
[[ $(json photos .data.place.status) == ACTIVE ]] || fail 'a photo replace changed the status'
[[ $(json photos '.data.place.syncVersion | tonumber') -gt $version_before ]] || fail 'the sync version did not move'
echo "✓ syncVersion $version_before → $(json photos .data.place.syncVersion)"

step '9. nearby, the sticker, the QR redirect and the detail by code'
# The largest limit: the walk's Place must not drop out behind the pilot corpus.
call nearby 200 "$BASE/places/nearby?lat=$walk_lat&lng=$walk_lng&radiusM=500&limit=50&lang=en" "${mobile[@]}" -H "$(device)"
[[ $(json nearby "[.data[] | select(.id == \"$place_id\")] | .[0].walkingEtaMinutes") =~ ^[0-9]+$ ]] ||
  fail 'the Place is not nearby, or has no walking ETA'
call qr-svg 200 "$BASE/admin/places/$place_id/qr" "${console[@]}" -b "$(admin)"
catalog_node '
  const QRCode = require("qrcode");
  const fs = require("fs");
  const [file, url] = process.argv.slice(1);
  const svg = fs.readFileSync(file, "utf8");
  QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 }).then((expected) => {
    // The dark modules: the one path with a stroke.
    const path = /<path stroke="[^"]*" d="([^"]+)"/.exec(expected)[1];
    if (!svg.includes(path)) { console.error("✗ the sticker does not encode " + url); process.exit(1); }
    console.log("✓ the sticker encodes " + url);
  });' "$work/qr-svg.json" "$ROOT/q/$code"
scans_before=$(catalog_sql "SELECT COALESCE(sum(scans), 0) FROM place_qr_scans_daily WHERE place_id = '$place_id'")
status=$(curl -sS -o /dev/null -D "$work/q.h" -w '%{http_code}' "$ROOT/q/$code")
[[ $status == 302 ]] || fail "/q answered $status"
grep -qi "^location: .*/p/$code" "$work/q.h" || fail '/q does not redirect to the universal link'
grep -qi '^cache-control: no-store' "$work/q.h" || fail '/q is cacheable'
scans_after=$(catalog_sql "SELECT sum(scans) FROM place_qr_scans_daily WHERE place_id = '$place_id'")
[[ $scans_after == $((scans_before + 1)) ]] || fail "scans went from $scans_before to $scans_after"
echo "✓ /q → 302, one scan counted"
call by-code 200 "$BASE/places/by-code/$code?lang=en" "${mobile[@]}" -H "$(device)"
[[ $(json by-code .data.id) == "$place_id" ]] || fail 'by-code returned another Place'

step '10. delete → removed from sync, unavailable by code; restore → back'
call delete 204 -X DELETE "$BASE/admin/places/$place_id" "${console[@]}" -b "$(admin)"
sleep "$LAG_WAIT"
sync sync-deleted "$version_2"
[[ $(json sync-deleted "[.data.removedPlaceIds[] | select(. == \"$place_id\")] | length") == 1 ]] ||
  fail 'the deleted Place is not listed as removed'
call by-code-gone 404 "$BASE/places/by-code/$code?lang=en" "${mobile[@]}" -H "$(device)"
[[ $(json by-code-gone .error.code) == PLACE_UNAVAILABLE ]] || fail 'a deleted Place is not PLACE_UNAVAILABLE'
call restore 200 -X POST "$BASE/admin/places/$place_id/restore" "${console[@]}" -b "$(admin)"
[[ $(json restore .data.place.status) == ACTIVE ]] || fail 'the restored Place is not ACTIVE'
call by-code-back 200 "$BASE/places/by-code/$code?lang=en" "${mobile[@]}" -H "$(device)"

step '11. delete the walk Place again, leaving no test Place on the map'
forget_places
[[ $(catalog_sql "SELECT count(*) FROM places WHERE id = '$place_id' AND deleted_at IS NULL") == 0 ]] ||
  fail 'the walk Place is still live'
echo '✓ the walk Place is deleted'

printf '\n✓ catalog walk complete\n'
