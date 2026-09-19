#!/usr/bin/env bash
# Live walk of the owner subscription against a running stack (identity, catalog, billing, gateway,
# NATS, Redis, Mailpit): a verified owner gets a FREE account, Stripe's events — synthetic, signed
# with the SDK's test helper and billing's local webhook secret — move it to Growth and back, the
# owner's Venues follow, dunning rings the bell, and an admin manages plans and pins a grant. Needs
# no Stripe account. Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: services/gateway/scripts/walk-billing.sh
#   BASE, ROOT and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden. `pnpm seed:dev` gives
#   the local Growth and Pro plans; without a sandbox their monthly prices are local rows, inserted
#   by SQL once, since registering a price reads it from Stripe.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
venues=()
cleanup() {
  # Best-effort: a failed walk leaves no Venue on the demo map.
  for id in "${venues[@]}"; do
    curl -sS -o /dev/null -X DELETE "$BASE/admin/places/$id" "${console[@]}" \
      -b "wf_at=$(cat "$work/admin.at" 2>/dev/null)" || true
  done
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

password='correct horse battery'
as() { echo "wf_at=$(cat "$work/$1.at")"; }
email_of() { echo "walk-billing-$1-$stamp@example.com"; }

# refresh WHO — rotates the session into a token carrying the account's current claims.
refresh() {
  call "$1-refresh" 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$(cat "$work/$1.rt")"
  cookie_value "$1-refresh" wf_at >"$work/$1.at"
  cookie_value "$1-refresh" wf_rt >"$work/$1.rt"
}

# event_at N — the N-th synthetic event's `created`: distinct seconds, an hour back, in order. A
# same-second tie needs a Stripe re-read, which the integration suite covers with the fake.
event_at() { echo $((clock + $1 * 10)); }

# post NAME TYPE CREATED OBJECT_JSON — a signed synthetic event posted to the gateway's webhook.
post() {
  local name=$1 type=$2 created=$3 object=$4 id
  id="evt_walk_${stamp}_${name}"
  jq -nc --arg id "$id" --arg type "$type" --argjson created "$created" --argjson object "$object" \
    '{id: $id, object: "event", api_version: "2026-08-26.dahlia", type: $type, created: $created,
      livemode: false, data: {object: $object}}' >"$work/$name.event.json"
  local signature
  signature=$(node "$repo_root/services/billing/scripts/sign-test-event.mjs" <"$work/$name.event.json")
  call "$name" 204 -X POST "$ROOT/api/webhooks/stripe" -H 'content-type: application/json' \
    -H "stripe-signature: $signature" --data-binary "@$work/$name.event.json"
  echo "$id" >"$work/$name.id"
}

# processed NAME — the event's status is final (the worker ran).
event_status() { billing_sql "SELECT status FROM billing_events WHERE stripe_event_id = '$(cat "$work/$1.id")'"; }
processed() { [[ $(event_status "$1") == "${2:-PROCESSED}" ]]; }

subscription_object() {
  jq -nc --arg sub "$subscription" --arg cus "$customer" --arg price "$1" --arg status "$2" \
    --argjson now "$(date +%s)" \
    '{id: $sub, object: "subscription", customer: $cus, status: $status, cancel_at_period_end: false,
      items: {object: "list", data: [{price: {id: $price}, current_period_start: $now,
      current_period_end: ($now + 2592000)}]}}'
}

invoice_object() {
  jq -nc --arg sub "$subscription" --arg cus "$customer" --argjson attempt "$1" \
    '{id: ("in_" + $sub), object: "invoice", customer: $cus, attempt_count: $attempt,
      next_payment_attempt: null, parent: {subscription_details: {subscription: $sub}}}'
}

account_field() { billing_sql "SELECT $1 FROM billing_accounts WHERE owner_user_id = '$owner_id'"; }
account_is() { [[ $(account_field "$1") == "$2" ]]; }
venue_field() { catalog_sql "SELECT $2 FROM places WHERE id = '$1'"; }
venue_is() { [[ $(venue_field "$1" "$2") == "$3" ]]; }
feed_has() {
  curl -sS "$BASE/notifications" "${console[@]}" -b "$(as owner)" |
    jq -e --arg type "$1" '[.data[] | select(.type == $type)] | length >= 1' >/dev/null
}
mail_arrived() { [[ $(mail_count "$(email_of owner)" "$1") -ge ${2:-1} ]]; }

reset_local_state
stamp=$(date +%s)
clock=$((stamp - 3600))

step '1. an owner is approved and gets a FREE account within seconds'
seed_dev
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
call owner-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d "$(body --arg e "$(email_of owner)" --arg p "$password" '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
cookie_value owner-register wf_at >"$work/owner.at"
cookie_value owner-register wf_rt >"$work/owner.rt"
owner_id=$(json owner-register .data.user.id)
verify_token=$(mail_token "$(email_of owner)" 'Confirm your email')
call owner-verify 204 -X POST "$BASE/auth/email/verify" "${console[@]}" -d "$(body --arg t "$verify_token" '{token: $t}')"
refresh owner
call owner-apply 201 -X POST "$BASE/owner/registration" "${console[@]}" -b "$(as owner)" \
  -d '{"businessName":"Quán thử billing","businessAddress":"12 Lê Lợi, Quận 1","contactName":"An","contactPhone":"+84901234567","nationalId":"079201001234","ownerAgreementVersion":"2026-09-01"}'
call approve 200 -X POST "$BASE/admin/owner-registrations/$(json owner-apply .data.registration.id)/approve" \
  "${console[@]}" -b "$(as admin)" -d '{}'
wait_for 'a FREE account within 5 s' 5 account_is subscription_status NONE
account_id=$(account_field id)
[[ $(account_field entitlements_version) == 1 ]] || fail 'the first grants are not version 1'
[[ $(billing_sql "SELECT count(*) FROM outbox_events WHERE subject = 'billing.entitlements.changed' AND payload->>'ownerUserId' = '$owner_id' AND payload->>'entitlementsVersion' = '1'") == 1 ]] ||
  fail 'no billing.entitlements.changed version 1'
echo "✓ account $account_id, version 1, billing.entitlements.changed published"
missing=$(comm -23 \
  <(identity_sql "SELECT id FROM users WHERE owner_verified_at IS NOT NULL ORDER BY id") \
  <(billing_sql "SELECT owner_user_id FROM billing_accounts ORDER BY owner_user_id"))
[[ -z $missing ]] || fail "owners without a billing account: $missing"
echo '✓ every verified owner, those verified before billing existed included, has an account'

step '2. the plan page reads Postgres; the plans on offer'
refresh owner
call overview 200 "$BASE/owner/billing" "${console[@]}" -b "$(as owner)"
[[ $(json overview .data.plan.code) == FREE && $(json overview .data.entitlements.maxPlaces) == 1 ]] ||
  fail "overview: $(jq -c .data "$work/overview.json")"
[[ $(json overview .data.entitlements.autoNarration) == false ]] || fail 'Free narrates automatically'
growth_price=price_walk_growth_monthly
price_row=$(catalog_node 'process.stdout.write(require("@wayfare/contracts").newId())')
billing_sql "INSERT INTO plan_prices (id, plan_id, stripe_price_id, billing_interval, amount_minor, currency, updated_at)
  SELECT '$price_row', p.id, '$growth_price', 'MONTH', 900, 'USD', now() FROM plans p
  WHERE p.code = 'GROWTH' AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM plan_prices WHERE plan_id = p.id AND billing_interval = 'MONTH' AND is_active)" >/dev/null
growth_price=$(billing_sql "SELECT pp.stripe_price_id FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id
  WHERE p.code = 'GROWTH' AND p.deleted_at IS NULL AND pp.billing_interval = 'MONTH' AND pp.is_active")
call plans 200 "$BASE/owner/billing/plans" "${console[@]}" -b "$(as owner)"
[[ $(json plans '[.data[].code] | index("GROWTH") != null') == true ]] || fail 'Growth is not on offer'
[[ $(json plans '[.data[].code] | index("FREE") == null') == true ]] || fail 'FREE is on offer'
echo "✓ on offer: $(json plans '[.data[].code] | join(", ")'); Growth monthly is $growth_price"

step "3. two Venues; a checkout's session and subscription events move the owner to Growth"
for index in 1 2; do
  read -r lat lng < <(walk_location $((index + 4)))
  name="Quán billing $index $stamp"
  description="Một quán thử số $index của bài đi bộ billing."
  id=$(catalog_node 'process.stdout.write(require("@wayfare/contracts").newId())')
  hash=$(catalog_node '
    const { contentHash } = require("@wayfare/nest-common");
    process.stdout.write(contentHash({ name: process.argv[1], description: process.argv[2] }));' "$name" "$description")
  code=$(printf 'B%07d' $(((stamp + index) % 10000000)))
  catalog_sql "INSERT INTO places (
      id, kind, owner_user_id, public_code, category_id, area_id, name_vi, description_vi, content_hash,
      location, auto_narration_enabled, discovery_boost, status, activation_requested_at, published_at,
      sync_version, created_by_id, created_at, updated_at)
    SELECT '$id', 'VENUE', '$owner_id', '$code', c.id, '$(pilot_area_id)', '$name', '$description',
      '$hash', ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography, false, 0, 'ACTIVE', now(), now(),
      nextval('catalog_sync_version_seq'), '$owner_id', now() - interval '$((3 - index)) minutes', now()
    FROM categories c WHERE c.code = 'RESTAURANT'" >/dev/null
  for lang in vi en; do
    catalog_sql "INSERT INTO place_localizations (place_id, lang, name, description, source_content_hash,
        translation_source, audio_status, audio_source_content_hash, audio_object_path, audio_sha256,
        audio_bytes, audio_duration_ms)
      VALUES ('$id', '$lang', '$name', '$description', '$hash',
        '$([[ $lang == vi ]] && echo SOURCE || echo MACHINE)', 'READY', '$hash',
        'audio/$hash-$lang.mp3', '$(printf 'e%.0s' {1..64})', 1000, 2000)" >/dev/null
  done
  venues+=("$id")
done
older=${venues[0]}
newer=${venues[1]}
echo "✓ Venues $older (older) and $newer, ACTIVE, not auto-narrated"
customer="cus_walk_$stamp"
subscription="sub_walk_$stamp"
post checkout checkout.session.completed "$(event_at 1)" \
  "$(jq -nc --arg acc "$account_id" --arg cus "$customer" --arg sub "$subscription" \
    '{id: "cs_walk", object: "checkout.session", mode: "subscription", client_reference_id: $acc, customer: $cus, subscription: $sub}')"
wait_for 'the checkout linked the customer' 5 account_is stripe_customer_id "$customer"
post created customer.subscription.created "$(event_at 2)" "$(subscription_object "$growth_price" active)"
wait_for 'the event was processed' 5 processed created
wait_for 'the account is on Growth, version 2' 5 account_is entitlements_version 2
[[ $(billing_sql "SELECT p.code FROM billing_accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = '$account_id'") == GROWTH ]] ||
  fail 'the plan is not Growth'
wait_for 'catalog turned auto-narration on for the older Venue' 5 venue_is "$older" auto_narration_enabled t
wait_for '… and the newer one' 5 venue_is "$newer" auto_narration_enabled t
wait_for 'the bell shows SUBSCRIPTION_ACTIVATED' 5 feed_has SUBSCRIPTION_ACTIVATED

step '4. a failed payment starts dunning, rings and emails; a paid invoice ends it; a redelivery is one row'
post failed invoice.payment_failed "$(event_at 3)" "$(invoice_object 1)"
wait_for 'dunning started' 5 account_is 'dunning_started_at IS NOT NULL' t
wait_for 'the bell shows SUBSCRIPTION_PAYMENT_FAILED' 5 feed_has SUBSCRIPTION_PAYMENT_FAILED
wait_for 'the PAYMENT_FAILED email arrived' 5 mail_arrived 'payment did not go through'
[[ $(account_field max_places) == 10 ]] || fail 'the grants changed during dunning'
refresh owner
call dunning 200 "$BASE/owner/billing" "${console[@]}" -b "$(as owner)"
[[ $(json dunning '.data.dunning.since') != null ]] || fail 'the overview does not show dunning'
post paid invoice.paid "$(event_at 4)" "$(invoice_object 2)"
wait_for 'dunning cleared' 5 account_is 'dunning_started_at IS NULL' t
call paid-again 204 -X POST "$ROOT/api/webhooks/stripe" -H 'content-type: application/json' \
  -H "stripe-signature: $(node "$repo_root/services/billing/scripts/sign-test-event.mjs" <"$work/paid.event.json")" \
  --data-binary "@$work/paid.event.json"
[[ $(billing_sql "SELECT count(*) FROM billing_events WHERE stripe_event_id = '$(cat "$work/paid.id")'") == 1 ]] ||
  fail 'the redelivery made a second row'
echo '✓ the redelivered event is one row'

step '5. cancelling falls back to FREE: the newer Venue is unpublished; a new subscription brings it back'
post deleted customer.subscription.deleted "$(event_at 5)" "$(subscription_object "$growth_price" canceled)"
wait_for 'the account is on FREE' 5 account_is 'subscription_status' CANCELED
[[ $(billing_sql "SELECT p.code FROM billing_accounts a JOIN plans p ON p.id = a.plan_id WHERE a.id = '$account_id'") == FREE ]] ||
  fail 'the plan is not FREE'
wait_for 'the newer Venue is INACTIVE (ENTITLEMENT_LIMIT)' 5 venue_is "$newer" "status || '/' || coalesce(inactive_reason, '')" 'INACTIVE/ENTITLEMENT_LIMIT'
venue_is "$older" status ACTIVE || fail 'the older Venue was unpublished'
wait_for 'auto-narration is off' 5 venue_is "$older" auto_narration_enabled f
wait_for 'the bell shows PLACE_UNPUBLISHED' 5 feed_has PLACE_UNPUBLISHED
wait_for 'the bell shows ENTITLEMENTS_REDUCED' 5 feed_has ENTITLEMENTS_REDUCED
wait_for 'the ENTITLEMENTS_REDUCED email arrived' 5 mail_arrived 'plan changed'
post recreated customer.subscription.created "$(event_at 6)" "$(subscription_object "$growth_price" active)"
wait_for 'the newer Venue is ACTIVE again' 5 venue_is "$newer" status ACTIVE
wait_for 'the bell shows PLACE_ACTIVATED' 5 feed_has PLACE_ACTIVATED

step '6. plans: create, dry run, apply; retiring a plan with a subscriber is refused'
plan_code="WALK_$stamp"
grants='{"maxPlaces":3,"autoNarration":true,"narrationLanguageScope":"BASIC","maxPhotosPerPlace":5,"maxMenuItemsPerPlace":50,"discoveryBoostSlots":0,"aiCreditsPerDay":0,"analyticsLevel":"NONE","canSellVouchers":false,"voucherCommissionBps":null}'
call plan-too-wide 400 -X POST "$BASE/admin/plans" "${console[@]}" -b "$(as admin)" \
  -d "$(jq -nc --arg code "$plan_code" --argjson g "$grants" '{code: $code, name: "Walk", sortOrder: 90, grants: ($g + {maxPlaces: 500})}')"
call plan-create 201 -X POST "$BASE/admin/plans" "${console[@]}" -b "$(as admin)" \
  -d "$(jq -nc --arg code "$plan_code" --argjson g "$grants" '{code: $code, name: "Walk", sortOrder: 90, grants: $g}')"
walk_plan=$(json plan-create .data.plan.id)
growth_plan=$(billing_sql "SELECT id FROM plans WHERE code = 'GROWTH' AND deleted_at IS NULL")
before=$(billing_sql "SELECT count(*) FROM outbox_events WHERE subject = 'billing.entitlements.changed'")
call dry-run 200 -X POST "$BASE/admin/plans/$growth_plan/apply?dryRun=true" "${console[@]}" -b "$(as admin)"
[[ $(json dry-run .data.dryRun) == true ]] || fail 'not a dry run'
[[ $(billing_sql "SELECT count(*) FROM outbox_events WHERE subject = 'billing.entitlements.changed'") == "$before" ]] ||
  fail 'the dry run wrote events'
echo "✓ dry run: $(json dry-run '.data | {affected, skippedPinned, wouldUnpublishPlaces} | tostring')"
call apply 200 -X POST "$BASE/admin/plans/$growth_plan/apply" "${console[@]}" -b "$(as admin)"
echo "✓ applied: $(json apply '.data | {affected, skippedPinned, failed} | tostring')"
call retire-growth 409 -X DELETE "$BASE/admin/plans/$growth_plan" "${console[@]}" -b "$(as admin)"
[[ $(json retire-growth .error.code) == PLAN_HAS_SUBSCRIBERS ]] || fail 'not PLAN_HAS_SUBSCRIBERS'
call retire-walk 204 -X DELETE "$BASE/admin/plans/$walk_plan" "${console[@]}" -b "$(as admin)"

step '7. a pinned override survives a subscription event; unpinning re-derives; the Venues are deleted'
call override 200 -X PATCH "$BASE/admin/billing/accounts/$account_id/entitlements" "${console[@]}" -b "$(as admin)" \
  -d "$(jq -nc --argjson g "$grants" '{grants: ($g + {maxPlaces: 7}), reason: "Walk: a negotiated grant"}')"
[[ $(json override .data.account.pinned) == true && $(json override .data.account.entitlements.maxPlaces) == 7 ]] ||
  fail "override: $(jq -c .data.account "$work/override.json")"
post updated customer.subscription.updated "$(event_at 7)" "$(subscription_object "$growth_price" active)"
wait_for 'the event was processed' 5 processed updated
[[ $(account_field max_places) == 7 && $(account_field entitlements_pinned) == t ]] ||
  fail 'the subscription event changed the pinned grants'
echo '✓ the pinned grants survived the subscription event'
call unpin 200 -X POST "$BASE/admin/billing/accounts/$account_id/unpin" "${console[@]}" -b "$(as admin)" \
  -d '{"reason":"Walk: the deal ended"}'
[[ $(json unpin .data.account.pinned) == false && $(json unpin .data.account.entitlements.maxPlaces) == 10 ]] ||
  fail "unpin: $(jq -c .data.account "$work/unpin.json")"
echo '✓ unpinned: back to Growth grants'
call events 200 "$BASE/admin/billing/events?billingAccountId=$account_id&pageSize=50" "${console[@]}" -b "$(as admin)"
echo "✓ $(json events '.meta.total') recorded events for the account"
for id in "${venues[@]}"; do
  call "delete-$id" 204 -X DELETE "$BASE/admin/places/$id" "${console[@]}" -b "$(as admin)"
done
venues=()

printf '\n✓ walk-billing: all steps passed\n'
