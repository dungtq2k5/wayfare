#!/usr/bin/env bash
# Live walk of account erasure against a running stack (identity, catalog, billing, gateway, NATS,
# Redis, Mailpit): a tourist erases and their address is free again; the refusals; an owner whose
# subscription can still charge is refused until it is cancelled, then erases and their Venues stop
# narrating; an applicant's application is withdrawn and cleared. Needs no Stripe account: the
# subscription is signed synthetic events, as in walk-billing.sh. Uses http://localhost only.
#
# Usage: services/gateway/scripts/walk-erasure.sh
#   BASE, ROOT and APP_VERSION may be overridden. Step 8 stops billing to show erasure fails closed;
#   it runs only when BILLING_STOP and BILLING_START name the commands that stop and start it.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
APP_VERSION=${APP_VERSION:-1.0.0}
work=$(mktemp -d)
cleanup() {
  forget_places
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
mobile=(-H 'x-wayfare-client: mobile' -H "x-wayfare-app-version: $APP_VERSION" -H 'content-type: application/json')
password='correct horse battery'
as() { echo "wf_at=$(cat "$work/$1.at")"; }
email_of() { echo "walk-erasure-$1-$stamp@example.com"; }
erase_body() { body --arg p "${1:-$password}" --arg c "${2:-DELETE}" '{currentPassword: $p, confirm: $c}'; }

# person NAME — registers NAME, verifies the address and keeps its console session.
person() {
  call "$1-register" 201 -X POST "$BASE/auth/register" "${console[@]}" \
    -d "$(body --arg e "$(email_of "$1")" --arg p "$password" '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
  cookie_value "$1-register" wf_at >"$work/$1.at"
  cookie_value "$1-register" wf_rt >"$work/$1.rt"
  json "$1-register" .data.user.id >"$work/$1.id"
  local token
  token=$(mail_token "$(email_of "$1")" 'Confirm your email')
  call "$1-verify" 204 -X POST "$BASE/auth/email/verify" "${console[@]}" -d "$(body --arg t "$token" '{token: $t}')"
  refresh "$1"
}

refresh() {
  call "$1-refresh" 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$(cat "$work/$1.rt")"
  cookie_value "$1-refresh" wf_at >"$work/$1.at"
  cookie_value "$1-refresh" wf_rt >"$work/$1.rt"
}

# apply NAME — NAME applies to become an owner.
apply() {
  call "$1-apply" 201 -X POST "$BASE/owner/registration" "${console[@]}" -b "$(as "$1")" \
    -d '{"businessName":"Quán thử xoá","businessAddress":"12 Lê Lợi, Quận 1","contactName":"An","contactPhone":"+84901234567","nationalId":"079201001234","applicantNote":"The stall at the corner.","ownerAgreementVersion":"2026-09-01"}'
  json "$1-apply" .data.registration.id >"$work/$1.registration"
}

user_field() { identity_sql "SELECT $2 FROM users WHERE id = '$(cat "$work/$1.id")'"; }
registration_field() { identity_sql "SELECT $2 FROM owner_registrations WHERE id = '$(cat "$work/$1.registration")'"; }
venue_field() { catalog_sql "SELECT $2 FROM places WHERE id = '$1'"; }
venue_is() { [[ $(venue_field "$1" "$2") == "$3" ]]; }
account_field() { billing_sql "SELECT $1 FROM billing_accounts WHERE owner_user_id = '$(cat "$work/owner.id")'"; }
account_is() { [[ $(account_field "$1") == "$2" ]]; }

# post NAME TYPE CREATED OBJECT_JSON — a signed synthetic Stripe event posted to the gateway's webhook.
post() {
  local name=$1 type=$2 created=$3 object=$4 id signature
  id="evt_erasure_${stamp}_${name}"
  jq -nc --arg id "$id" --arg type "$type" --argjson created "$created" --argjson object "$object" \
    '{id: $id, object: "event", api_version: "2026-08-26.dahlia", type: $type, created: $created,
      livemode: false, data: {object: $object}}' >"$work/$name.event.json"
  signature=$(node "$repo_root/services/billing/scripts/sign-test-event.mjs" <"$work/$name.event.json")
  call "$name" 204 -X POST "$ROOT/api/webhooks/stripe" -H 'content-type: application/json' \
    -H "stripe-signature: $signature" --data-binary "@$work/$name.event.json"
}

subscription_object() {
  jq -nc --arg sub "sub_erasure_$stamp" --arg cus "cus_erasure_$stamp" --arg price "$1" \
    --arg status "$2" --argjson now "$(date +%s)" \
    '{id: $sub, object: "subscription", customer: $cus, status: $status, cancel_at_period_end: false,
      items: {object: "list", data: [{price: {id: $price}, current_period_start: $now,
      current_period_end: ($now + 2592000)}]}}'
}

# venue STATUS INDEX — an owner's Venue inserted by SQL, as walk-billing.sh does; prints its id.
venue() {
  local status=$1 index=$2 id hash name lat lng
  read -r lat lng < <(walk_location "$index")
  name="Quán xoá $index $stamp"
  id=$(catalog_node 'process.stdout.write(require("@wayfare/contracts").newId())')
  hash=$(catalog_node '
    const { contentHash } = require("@wayfare/nest-common");
    process.stdout.write(contentHash({ name: process.argv[1], description: "Một quán thử." }));' "$name")
  catalog_sql "INSERT INTO places (
      id, kind, owner_user_id, public_code, category_id, area_id, name_vi, description_vi, content_hash,
      location, auto_narration_enabled, discovery_boost, status, activation_requested_at, published_at,
      sync_version, created_by_id, created_at, updated_at)
    SELECT '$id', 'VENUE', '$(cat "$work/owner.id")', '$(printf 'E%07d' $(((stamp + index) % 10000000)))',
      c.id, '$(pilot_area_id)', '$name', 'Một quán thử.', '$hash',
      ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography, false, 0, '$status',
      $([[ $status == DRAFT ]] && echo NULL || echo 'now()'), $([[ $status == ACTIVE ]] && echo 'now()' || echo NULL),
      nextval('catalog_sync_version_seq'), '$(cat "$work/owner.id")', now(), now()
    FROM categories c WHERE c.code = 'RESTAURANT'" >/dev/null
  remember_place "$id"
  echo "$id"
}

reset_local_state
stamp=$(date +%s)
clock=$((stamp - 3600))
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"

step '1. a tourist registers, verifies, and signs in on a phone that claims its device'
person tourist
call device 201 -X POST "$BASE/devices" "${mobile[@]}" \
  -d '{"platform":"ANDROID","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'
device_id=$(json device .data.deviceId)
call mobile-login 200 -X POST "$BASE/auth/login" "${mobile[@]}" -H "authorization: Bearer $(json device .data.accessToken)" \
  -d "$(body --arg e "$(email_of tourist)" --arg p "$password" '{email: $e, password: $p}')"
mobile_access=$(json mobile-login .data.accessToken)
mobile_refresh=$(json mobile-login .data.refreshToken)
[[ $(identity_sql "SELECT user_id FROM devices WHERE id = '$device_id'") == "$(cat "$work/tourist.id")" ]] ||
  fail 'the device is not claimed'
echo "✓ device $device_id claimed"

step '2. a wrong password is 401, a lowercase "delete" is 400, the real thing is 204'
call erase-wrong 401 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as tourist)" -d "$(erase_body 'not my password')"
[[ $(json erase-wrong .error.code) == INVALID_CREDENTIALS ]] || fail 'not INVALID_CREDENTIALS'
call erase-lower 400 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as tourist)" -d "$(erase_body "$password" delete)"
call erase-tourist 204 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as tourist)" -d "$(erase_body)"
grep -qi '^set-cookie: wf_at=;' "$work/erase-tourist.h" || fail 'wf_at was not cleared'
grep -qi '^set-cookie: wf_rt=;' "$work/erase-tourist.h" || fail 'wf_rt was not cleared'
echo '✓ both auth cookies cleared'

step '3. every token is refused; the row keeps nothing personal; the device is released'
expect_refused 'the console session' "$(cat "$work/tourist.at")"
call phone-refresh 401 -X POST "$BASE/auth/refresh" "${mobile[@]}" -d "$(body --arg t "$mobile_refresh" '{refreshToken: $t}')"
status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/users/me" "${mobile[@]}" -H "authorization: Bearer $mobile_access")
[[ $status == 401 ]] || fail "the phone's access token still works (HTTP $status)"
tourist_id=$(cat "$work/tourist.id")
row=$(user_field tourist "email || '|' || coalesce(password_hash, '-') || '|' || coalesce(full_name, '-') || '|' || is_email_verified || '|' || (erased_at IS NOT NULL) || '|' || (deleted_at = erased_at)")
[[ $row == "erased+$tourist_id@invalid.wayfare.app|-|-|false|true|true" ]] || fail "the row: $row"
echo "✓ the row: erased+$tourist_id@invalid.wayfare.app, no password or name, erased_at stamped"
[[ $(identity_sql "SELECT coalesce(user_id::text, '-') FROM devices WHERE id = '$device_id'") == - ]] ||
  fail 'the device is still claimed'
[[ $(identity_sql "SELECT count(*) FROM sessions WHERE user_id = '$tourist_id' AND (revoked_at IS NULL OR ip IS NOT NULL OR user_agent IS NOT NULL)") == 0 ]] ||
  fail 'a session is live or keeps its origin'
[[ $(identity_sql "SELECT count(*) FROM action_tokens WHERE user_id = '$tourist_id'") == 0 ]] || fail 'action tokens remain'
[[ $(identity_sql "SELECT count(*) FROM email_deliveries WHERE recipient_user_id = '$tourist_id' AND (to_email_masked IS NOT NULL OR to_email_hash IS NOT NULL)") == 0 ]] ||
  fail 'a delivery keeps the address'
[[ $(identity_sql "SELECT count(*) FROM outbox_events WHERE subject = 'identity.user.erased' AND payload->>'userId' = '$tourist_id'") == 1 ]] ||
  fail 'not one identity.user.erased'
[[ $(identity_sql "SELECT count(*) FROM outbox_events WHERE subject = 'audit.record' AND payload->>'action' = 'USER_ERASED' AND payload->'resource'->>'id' = '$tourist_id'") == 1 ]] ||
  fail 'not one USER_ERASED audit row'
echo '✓ the device is released, the sessions are revoked and keep no IP, one USER_ERASED and one identity.user.erased'

step '4. the address is free: registering it again is a new account'
call reregister 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d "$(body --arg e "$(email_of tourist)" --arg p "$password" '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
[[ $(json reregister .data.user.id) != "$tourist_id" ]] || fail 'the same id came back'
echo "✓ $(email_of tourist) registered again as $(json reregister .data.user.id)"

step '5. a live email-change revert link refuses erasure'
person changer
new_address="walk-erasure-changed-$stamp@example.com"
call change 202 -X POST "$BASE/auth/email/change" "${console[@]}" -b "$(as changer)" \
  -d "$(body --arg e "$new_address" --arg p "$password" '{newEmail: $e, currentPassword: $p}')"
call confirm 204 -X POST "$BASE/auth/email/change/confirm" "${console[@]}" \
  -d "$(body --arg t "$(mail_token "$new_address" 'Confirm your new')" '{token: $t}')"
refresh changer
call erase-revert 409 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as changer)" -d "$(erase_body)"
[[ $(json erase-revert .error.code) == EMAIL_CHANGE_REVERT_PENDING ]] || fail 'not EMAIL_CHANGE_REVERT_PENDING'
[[ $(user_field changer "erased_at IS NULL") == t ]] || fail 'the account changed'

step '6. an owner whose subscription can still charge is refused until it is cancelled'
person owner
apply owner
call approve 200 -X POST "$BASE/admin/owner-registrations/$(cat "$work/owner.registration")/approve" \
  "${console[@]}" -b "$(as admin)" -d '{}'
wait_for 'a FREE billing account' 5 account_is subscription_status NONE
account_id=$(account_field id)
growth_price=$(billing_sql "SELECT pp.stripe_price_id FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id
  WHERE p.code = 'GROWTH' AND p.deleted_at IS NULL AND pp.billing_interval = 'MONTH' AND pp.is_active")
[[ -n $growth_price ]] || fail 'no active Growth monthly price: run pnpm seed:dev (and walk-billing.sh once)'
post checkout checkout.session.completed $((clock + 10)) \
  "$(jq -nc --arg acc "$account_id" --arg cus "cus_erasure_$stamp" --arg sub "sub_erasure_$stamp" \
    '{id: "cs_erasure", object: "checkout.session", mode: "subscription", client_reference_id: $acc, customer: $cus, subscription: $sub}')"
post created customer.subscription.created $((clock + 20)) "$(subscription_object "$growth_price" active)"
wait_for 'the owner is subscribed' 5 account_is subscription_status ACTIVE
refresh owner
call erase-subscribed 409 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as owner)" -d "$(erase_body)"
[[ $(json erase-subscribed .error.code) == OWNER_HAS_ACTIVE_OBLIGATIONS ]] || fail 'not OWNER_HAS_ACTIVE_OBLIGATIONS'
post deleted customer.subscription.deleted $((clock + 30)) "$(subscription_object "$growth_price" canceled)"
wait_for 'the subscription is cancelled' 5 account_is subscription_status CANCELED

step '7. the owner erases: their Venues stop narrating; an applicant erases: the application is withdrawn'
active=$(venue ACTIVE 1)
draft=$(venue DRAFT 2)
echo "✓ Venues $active (ACTIVE) and $draft (DRAFT)"
refresh owner
call erase-owner 204 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as owner)" -d "$(erase_body)"
wait_for 'the ACTIVE Venue is INACTIVE (OWNER)' 5 venue_is "$active" "status || '/' || coalesce(inactive_reason, '')" 'INACTIVE/OWNER'
wait_for 'the draft is soft-deleted' 5 venue_is "$draft" 'deleted_at IS NOT NULL' t
[[ $(catalog_sql "SELECT count(*) FROM outbox_events WHERE subject = 'catalog.place.status_changed' AND payload->>'placeId' = '$active' AND payload->>'to' = 'INACTIVE'") == 1 ]] ||
  fail 'no status change for the map'
echo '✓ the ACTIVE Venue left the map with its status change'
[[ $(registration_field owner "status || '|' || coalesce(national_id_last4, '-') || '|' || contact_name || contact_phone || '|' || coalesce(applicant_note, '-')") == 'APPROVED|-||-' ]] ||
  fail "the approved application: $(registration_field owner "status, national_id_last4, contact_name, applicant_note")"
echo '✓ the approved application keeps its status, without national ID, contact fields or note'
[[ $(account_field "count(*)") == 1 ]] || fail 'the billing account is gone'
echo '✓ the billing account is kept; the Stripe customer redaction ran through billing'
person applicant
apply applicant
call erase-applicant 204 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as applicant)" -d "$(erase_body)"
[[ $(registration_field applicant "status || '|' || coalesce(national_id_ciphertext, '-') || '|' || coalesce(applicant_note, '-')") == 'WITHDRAWN|-|-' ]] ||
  fail 'the application was not withdrawn and cleared'
echo '✓ the pending application is WITHDRAWN and cleared'

step '8. billing unreachable refuses erasure with 503, and nothing changes'
if [[ -n ${BILLING_STOP:-} && -n ${BILLING_START:-} ]]; then
  person fourth
  bash -c "$BILLING_STOP"
  sleep 1
  call erase-down 503 -X DELETE "$BASE/users/me" "${console[@]}" -b "$(as fourth)" -d "$(erase_body)"
  [[ $(user_field fourth "erased_at IS NULL") == t ]] || fail 'the account changed'
  bash -c "$BILLING_START"
  echo '✓ 503 with billing stopped; billing started again'
else
  echo '• skipped: set BILLING_STOP and BILLING_START to run it'
fi

printf '\nAll steps passed.\n'
