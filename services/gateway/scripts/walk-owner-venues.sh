#!/usr/bin/env bash
# Live walk of owner Venues and submissions against a running stack (identity, catalog, narration
# with the fake providers, billing, gateway, NATS, Redis, Mailpit, fake-gcs): an owner on Growth
# uploads photos and submits a Venue; a moderator approves it with the editorial values; narration
# publishes it; a later edit meets an admin's change as a named conflict; the plan's limits, the
# owner's visibility and a rejection. The subscription is signed synthetic events, as in
# walk-billing.sh: no Stripe account. Uses http://localhost only.
#
# Usage: services/gateway/scripts/walk-owner-venues.sh
#   Needs SEED_ACCOUNT_PASSWORD in services/identity/.env (moderator@wayfare.test) and `pnpm seed:dev`
#   run once (the Growth plan and the pilot area). BASE and ROOT may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
cleanup() {
  for pid in "${socket_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  # Best-effort: a failed walk leaves no pending submission holding uploads, and no Venue.
  if [[ -f $work/owner.at ]]; then
    for id in $(curl -sS "$BASE/owner/submissions?status=PENDING" "${console[@]}" \
      -b "wf_at=$(cat "$work/owner.at")" | jq -r '.data[]?.id'); do
      curl -sS -o /dev/null -X POST "$BASE/owner/submissions/$id/withdraw" "${console[@]}" \
        -b "wf_at=$(cat "$work/owner.at")" || true
    done
  fi
  forget_places
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

password='correct horse battery'
seed_password=$(grep -E '^SEED_ACCOUNT_PASSWORD=.+' "$repo_root/services/identity/.env" | cut -d= -f2- || true)
[[ -n $seed_password ]] || fail 'set SEED_ACCOUNT_PASSWORD in services/identity/.env (moderator@wayfare.test)'

as() { echo "wf_at=$(cat "$work/$1.at")"; }
email_of() { echo "walk-venues-$1-$stamp@example.com"; }
login() {
  call "$1-login" 200 -X POST "$BASE/auth/login" "${console[@]}" \
    -d "$(body --arg e "$2" --arg p "$3" '{email: $e, password: $p}')"
  cookie_value "$1-login" wf_at >"$work/$1.at"
}
refresh() {
  call "$1-refresh" 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$(cat "$work/$1.rt")"
  cookie_value "$1-refresh" wf_at >"$work/$1.at"
  cookie_value "$1-refresh" wf_rt >"$work/$1.rt"
}

# post NAME TYPE CREATED OBJECT_JSON — a signed synthetic Stripe event posted to the gateway's webhook.
post() {
  local name=$1 type=$2 created=$3 object=$4 id signature
  id="evt_venues_${stamp}_${name}"
  jq -nc --arg id "$id" --arg type "$type" --argjson created "$created" --argjson object "$object" \
    '{id: $id, object: "event", api_version: "2026-08-26.dahlia", type: $type, created: $created,
      livemode: false, data: {object: $object}}' >"$work/$name.event.json"
  signature=$(node "$repo_root/services/billing/scripts/sign-test-event.mjs" <"$work/$name.event.json")
  call "$name" 204 -X POST "$ROOT/api/webhooks/stripe" -H 'content-type: application/json' \
    -H "stripe-signature: $signature" --data-binary "@$work/$name.event.json"
}
subscription_object() {
  jq -nc --arg sub "sub_venues_$stamp" --arg cus "cus_venues_$stamp" --arg price "$1" \
    --arg status "$2" --argjson now "$(date +%s)" \
    '{id: $sub, object: "subscription", customer: $cus, status: $status, cancel_at_period_end: false,
      items: {object: "list", data: [{price: {id: $price}, current_period_start: $now,
      current_period_end: ($now + 2592000)}]}}'
}
account_is() {
  [[ $(billing_sql "SELECT $1 FROM billing_accounts WHERE owner_user_id = '$(cat "$work/owner.id")'") == "$2" ]]
}
projection_is() {
  [[ $(catalog_sql "SELECT $1 FROM owner_entitlements WHERE owner_user_id = '$(cat "$work/owner.id")'") == "$2" ]]
}
venue_is() { [[ $(catalog_sql "SELECT $2 FROM places WHERE id = '$1'") == "$3" ]]; }
feed_has() {
  curl -sS "$BASE/notifications" "${console[@]}" -b "$(as owner)" |
    jq -e --arg type "$1" '[.data[] | select(.type == $type)] | length >= 1' >/dev/null
}
feed_count() {
  curl -sS "$BASE/notifications" "${console[@]}" -b "$(as owner)" |
    jq --arg type "$1" '[.data[] | select(.type == $type)] | length'
}
mail_arrived() { [[ $(mail_count "$(email_of owner)" "$1") -ge ${2:-1} ]]; }
status_frame() {
  [[ $(frames owner "[.[] | select(.event == \"owner:place:status\" and .payload.status == \"$1\")] | length") -ge 1 ]]
}

# upload NAME SHADE — a JPEG signed, PUT and confirmed as the owner; prints its upload id.
upload() {
  local name=$1 bytes url status
  catalog_node '
    const sharp = require("sharp");
    const [out, shade] = process.argv.slice(1);
    sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: Number(shade), g: 90, b: 40 } } })
      .jpeg().toFile(out).catch((error) => { console.error(error); process.exit(1); });' \
    "$work/$name.jpg" "$2"
  bytes=$(stat -c %s "$work/$name.jpg")
  call "$name-sign" 201 -X POST "$BASE/uploads" "${console[@]}" -b "$(as owner)" \
    -d "$(body --argjson b "$bytes" '{purpose: "PLACE_PHOTO", contentType: "image/jpeg", bytes: $b}')" >&2
  url=$(json "$name-sign" .data.uploadUrl)
  local headers=()
  while IFS= read -r line; do headers+=(-H "$line"); done < <(json "$name-sign" '.data.requiredHeaders | to_entries[] | "\(.key): \(.value)"')
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "${headers[@]}" --data-binary "@$work/$name.jpg" "$url")
  [[ $status == 200 ]] || fail "$name: the signed PUT answered $status"
  call "$name-confirm" 200 -X POST "$BASE/uploads/$(json "$name-sign" .data.uploadId)/confirm" \
    "${console[@]}" -b "$(as owner)" >&2
  json "$name-sign" .data.uploadId
}

# payload [JQ_OVERRIDES] — the Venue's complete desired state, as this walk submits it.
payload() {
  jq -nc --arg name "Quán walk $stamp" --argjson lat "$lat" --argjson lng "$lng" \
    --argjson photos "${photos:-[]}" \
    '{nameVi: $name, descriptionVi: "Bún chả Hà Nội, nướng than hoa.", categoryCode: "RESTAURANT",
      location: {lat: $lat, lng: $lng}, addressVi: "12 Lê Lợi, Quận 1", priceBand: 2,
      phone: "+84901234567", websiteUrl: null,
      openingHours: [{weekday: 1, opensAt: "08:00", closesAt: "21:00", isClosed: false}],
      photos: $photos,
      menu: {menuCurrency: "VND", items: [{nameVi: "Bún chả", descriptionVi: null, priceMinor: 45000, isAvailable: true}]}}' |
    jq -c "${1:-.}"
}

reset_local_state
stamp=$(date +%s)
clock=$((stamp - 3600))
read -r lat lng < <(walk_location 7)

step '1. an approved owner moved to Growth by signed events; the owner socket open'
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
login admin "$BOOTSTRAP_SUPER_ADMIN_EMAIL" "$BOOTSTRAP_SUPER_ADMIN_PASSWORD"
login moderator moderator@wayfare.test "$seed_password"
call owner-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d "$(body --arg e "$(email_of owner)" --arg p "$password" '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
cookie_value owner-register wf_at >"$work/owner.at"
cookie_value owner-register wf_rt >"$work/owner.rt"
json owner-register .data.user.id >"$work/owner.id"
call owner-verify 204 -X POST "$BASE/auth/email/verify" "${console[@]}" \
  -d "$(body --arg t "$(mail_token "$(email_of owner)" 'Confirm your email')" '{token: $t}')"
refresh owner
call owner-apply 201 -X POST "$BASE/owner/registration" "${console[@]}" -b "$(as owner)" \
  -d '{"businessName":"Quán walk","businessAddress":"12 Lê Lợi, Quận 1","contactName":"An","contactPhone":"+84901234567","nationalId":"079201001234","ownerAgreementVersion":"2026-09-01"}'
call approve-owner 200 -X POST "$BASE/admin/owner-registrations/$(json owner-apply .data.registration.id)/approve" \
  "${console[@]}" -b "$(as admin)" -d '{}'
wait_for 'a FREE billing account' 5 account_is subscription_status NONE
growth_price=$(billing_sql "SELECT pp.stripe_price_id FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id
  WHERE p.code = 'GROWTH' AND p.deleted_at IS NULL AND pp.billing_interval = 'MONTH' AND pp.is_active")
[[ -n $growth_price ]] || fail 'no active Growth monthly price: run pnpm seed:dev (and walk-billing.sh once)'
post checkout checkout.session.completed $((clock + 10)) \
  "$(jq -nc --arg acc "$(billing_sql "SELECT id FROM billing_accounts WHERE owner_user_id = '$(cat "$work/owner.id")'")" \
    --arg cus "cus_venues_$stamp" --arg sub "sub_venues_$stamp" \
    '{id: "cs_venues", object: "checkout.session", mode: "subscription", client_reference_id: $acc, customer: $cus, subscription: $sub}')"
post created customer.subscription.created $((clock + 20)) "$(subscription_object "$growth_price" active)"
wait_for 'catalog knows the owner is on Growth' 10 projection_is max_places 10
refresh owner
socket owner "$(cat "$work/owner.at")"
wait_for 'the owner socket is ready' 5 saw owner connection:ready

step '2. two photos uploaded and confirmed, as the owner'
upload_1=$(upload photo-1 180)
upload_2=$(upload photo-2 90)
echo "✓ uploads $upload_1 and $upload_2"

step '3. a CREATE reserves a slot; the editorial fields and a location outside every area are refused'
photos=$(jq -nc --arg a "$upload_1" --arg b "$upload_2" '[{uploadId: $a, altTextVi: "Mặt tiền"}, {uploadId: $b, altTextVi: null}]')
call create 201 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --argjson p "$(payload)" '{kind: "CREATE", payload: $p}')"
submission=$(json create .data.submission.id)
call limits 200 "$BASE/owner/places/limits" "${console[@]}" -b "$(as owner)"
[[ $(json limits .data.reservedByPendingSubmissions) == 1 ]] || fail "limits: $(jq -c .data "$work/limits.json")"
call create-radius 400 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --argjson p "$(payload '. + {triggerRadiusM: 50}')" '{kind: "CREATE", payload: $p}')"
photos='[]' call create-outside 422 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --argjson p "$(photos='[]' payload '.location = {lat: 11.5, lng: 107.5}')" '{kind: "CREATE", payload: $p}')"
[[ $(json create-outside .error.code) == LOCATION_OUTSIDE_AREAS ]] || fail 'not LOCATION_OUTSIDE_AREAS'

step '4. the moderator reads the queue and the detail'
call queue 200 "$BASE/admin/submissions?pageSize=100" "${console[@]}" -b "$(as moderator)"
[[ $(json queue "[.data[] | select(.id == \"$submission\")] | length") == 1 ]] || fail 'the submission is not queued'
call detail 200 "$BASE/admin/submissions/$submission" "${console[@]}" -b "$(as moderator)"
[[ $(json detail '.data.livePlace') == null && $(json detail '.data.entitlements.maxPlaces') == 10 ]] ||
  fail "detail: $(jq -c '.data | {livePlace, entitlements, conflict}' "$work/detail.json")"
echo "✓ a creation: no live Venue, $(json detail '.data.diff | length') fields in the diff, the owner on Growth"

step '5. approved with radius 30 and priority 60: PROCESSING, narrated, ACTIVE'
call approve 200 -X POST "$BASE/admin/submissions/$submission/approve" "${console[@]}" -b "$(as moderator)" \
  -d '{"triggerRadiusM":30,"narrationPriority":60,"decisionNote":"Welcome to Wayfare"}'
venue=$(json approve .data.submission.placeId)
remember_place "$venue"
row=$(catalog_sql "SELECT kind || '|' || owner_user_id || '|' || trigger_radius_m || '|' || narration_priority || '|' || auto_narration_enabled FROM places WHERE id = '$venue'")
[[ $row == "VENUE|$(cat "$work/owner.id")|30|60|true" ]] || fail "the Venue: $row"
[[ $(catalog_sql "SELECT count(*) FROM place_photos WHERE place_id = '$venue'") == 2 ]] || fail 'not two photos'
echo "✓ Venue $venue: the owner's, the reviewer's values, auto-narrated, two photos"
wait_for 'the Venue is ACTIVE' 60 venue_is "$venue" status ACTIVE
wait_for 'the bell shows SUBMISSION_APPROVED' 5 feed_has SUBMISSION_APPROVED
wait_for 'the SUBMISSION_OUTCOME email arrived' 5 mail_arrived 'Your submission was reviewed'
wait_for 'the bell shows PLACE_ACTIVATED' 10 feed_has PLACE_ACTIVATED
wait_for 'the owner socket saw PROCESSING' 5 status_frame PROCESSING
wait_for '… and ACTIVE' 5 status_frame ACTIVE
[[ $(feed_count PLACE_EDITED_BY_ADMIN) == 0 ]] || fail 'the approval told the owner an admin edited their Venue'
echo '✓ no PLACE_EDITED_BY_ADMIN'

step '6. an UPDATE from the live fields; a second one supersedes it'
call mine 200 "$BASE/owner/places/$venue" "${console[@]}" -b "$(as owner)"
hash=$(json mine .data.editableHash)
photos=$(json mine '[.data.place.photos[] | {photoId: .id, altTextVi}]')
call update-1 201 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --arg v "$venue" --arg h "$hash" --argjson p "$(payload '.descriptionVi = "Một."')" \
    '{kind: "UPDATE", placeId: $v, baseEditableHash: $h, payload: $p}')"
call update-2 201 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --arg v "$venue" --arg h "$hash" --argjson p "$(payload '.descriptionVi = "Bún chả, nay có nem."')" \
    '{kind: "UPDATE", placeId: $v, baseEditableHash: $h, payload: $p}')"
call update-1-read 200 "$BASE/owner/submissions/$(json update-1 .data.submission.id)" "${console[@]}" -b "$(as owner)"
[[ $(json update-1-read .data.status) == SUPERSEDED ]] || fail 'the first UPDATE is not SUPERSEDED'
echo '✓ the first UPDATE is SUPERSEDED'
second=$(json update-2 .data.submission.id)

step "7. an admin changes the phone: approval names it; acknowledged, the edit goes live again"
call admin-phone 200 -X PATCH "$BASE/admin/places/$venue" "${console[@]}" -b "$(as admin)" -d '{"phone":"+84999999999"}'
call approve-conflict 409 -X POST "$BASE/admin/submissions/$second/approve" "${console[@]}" -b "$(as moderator)" \
  -d '{"triggerRadiusM":30,"narrationPriority":60}'
[[ $(json approve-conflict '.error.details.changedFields | join(",")') == phone ]] ||
  fail "conflict: $(jq -c .error "$work/approve-conflict.json")"
echo '✓ 409 SUBMISSION_CONFLICT naming ["phone"]'
call approve-ack 200 -X POST "$BASE/admin/submissions/$second/approve" "${console[@]}" -b "$(as moderator)" \
  -d '{"triggerRadiusM":30,"narrationPriority":60,"acknowledgeConflict":true}'
wait_for 'the new text sent it through PROCESSING' 5 status_frame PROCESSING
wait_for 'the Venue is ACTIVE again' 60 venue_is "$venue" "status || '|' || description_vi" 'ACTIVE|Bún chả, nay có nem.'

step '8. cancelled to FREE: a second CREATE and four photos are refused'
post deleted customer.subscription.deleted $((clock + 30)) "$(subscription_object "$growth_price" canceled)"
wait_for 'catalog knows the owner is on FREE' 10 projection_is max_places 1
photos='[]' call create-second 409 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --argjson p "$(photos='[]' payload)" '{kind: "CREATE", payload: $p}')"
[[ $(json create-second .error.code) == PLACE_LIMIT_REACHED ]] || fail 'not PLACE_LIMIT_REACHED'
upload_3=$(upload photo-3 30)
upload_4=$(upload photo-4 240)
call mine-2 200 "$BASE/owner/places/$venue" "${console[@]}" -b "$(as owner)"
photos=$(jq -nc --argjson kept "$(json mine-2 '[.data.place.photos[] | {photoId: .id, altTextVi}]')" \
  --arg c "$upload_3" --arg d "$upload_4" '$kept + [{uploadId: $c, altTextVi: null}, {uploadId: $d, altTextVi: null}]')
call four-photos 409 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --arg v "$venue" --arg h "$(json mine-2 .data.editableHash)" --argjson p "$(payload)" \
    '{kind: "UPDATE", placeId: $v, baseEditableHash: $h, payload: $p}')"
[[ $(json four-photos .error.code) == PHOTO_LIMIT_REACHED ]] || fail 'not PHOTO_LIMIT_REACHED'
echo '✓ PLACE_LIMIT_REACHED and PHOTO_LIMIT_REACHED on FREE'

step "9. the owner closes and reopens the Venue; an admin's deactivation is the admin's to undo"
call deactivate 200 -X POST "$BASE/owner/places/$venue/deactivate" "${console[@]}" -b "$(as owner)"
[[ $(json deactivate '.data.place.status + "|" + .data.place.inactiveReason') == 'INACTIVE|OWNER' ]] || fail 'not INACTIVE (OWNER)'
call reactivate 200 -X POST "$BASE/owner/places/$venue/reactivate" "${console[@]}" -b "$(as owner)"
[[ $(json reactivate .data.place.status) == ACTIVE ]] || fail "reactivated to $(json reactivate .data.place.status)"
echo '✓ INACTIVE (OWNER), then ACTIVE through the gate'
call admin-deactivate 200 -X POST "$BASE/admin/places/$venue/deactivate" "${console[@]}" -b "$(as admin)" \
  -d '{"reason":"Walk: an admin closes it"}'
call reactivate-admin 409 -X POST "$BASE/owner/places/$venue/reactivate" "${console[@]}" -b "$(as owner)"
call admin-reactivate 200 -X POST "$BASE/admin/places/$venue/activate" "${console[@]}" -b "$(as admin)"

step '10. a rejection: the note required, the owner told, the internal note never shown'
call mine-3 200 "$BASE/owner/places/$venue" "${console[@]}" -b "$(as owner)"
photos=$(json mine-3 '[.data.place.photos[] | {photoId: .id, altTextVi}]')
call update-3 201 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(as owner)" \
  -d "$(jq -nc --arg v "$venue" --arg h "$(json mine-3 .data.editableHash)" --argjson p "$(payload '.nameVi = "Tên mới"')" \
    '{kind: "UPDATE", placeId: $v, baseEditableHash: $h, payload: $p}')"
third=$(json update-3 .data.submission.id)
call reject-empty 400 -X POST "$BASE/admin/submissions/$third/reject" "${console[@]}" -b "$(as moderator)" -d '{}'
call reject 200 -X POST "$BASE/admin/submissions/$third/reject" "${console[@]}" -b "$(as moderator)" \
  -d '{"decisionNote":"Please keep the registered business name.","internalNote":"walk: staff only"}'
call rejected 200 "$BASE/owner/submissions/$third" "${console[@]}" -b "$(as owner)"
[[ $(json rejected .data.decisionNote) == 'Please keep the registered business name.' ]] || fail 'the owner does not see the note'
grep -q 'staff only' "$work/rejected.json" && fail 'the owner sees the internal note'
echo '✓ the owner sees the decision note, never the internal note'
wait_for 'the bell shows SUBMISSION_REJECTED' 5 feed_has SUBMISSION_REJECTED
wait_for 'a second SUBMISSION_OUTCOME email arrived' 5 mail_arrived 'Your submission was reviewed' 2
call delete-venue 204 -X DELETE "$BASE/admin/places/$venue" "${console[@]}" -b "$(as admin)"
rm -f "$work/walk-places"

printf '\nAll steps passed.\n'
