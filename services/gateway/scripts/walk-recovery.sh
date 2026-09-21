#!/usr/bin/env bash
# Live walk of support-assisted account recovery (api-endpoints-plan §1.10, rdm-spec I-14,
# ADR 0052) against a running stack (identity, catalog, billing, gateway, Mailpit, NATS, Redis).
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: services/gateway/scripts/walk-recovery.sh
#   Needs SEED_ACCOUNT_PASSWORD in services/identity/.env (admin@wayfare.test) and `pnpm seed:dev`.
#   BASE, ROOT and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

seed_password=$(grep -E '^SEED_ACCOUNT_PASSWORD=.+' "$repo_root/services/identity/.env" | cut -d= -f2- || true)
[[ -n $seed_password ]] || fail 'set SEED_ACCOUNT_PASSWORD in services/identity/.env (admin@wayfare.test)'

as() { echo "wf_at=$(cat "$work/$1.at")"; }

login() {
  call "$1-login" 200 -X POST "$BASE/auth/login" "${console[@]}" \
    -d "$(body --arg e "$2" --arg p "$3" '{email: $e, password: $p}')"
  cookie_value "$1-login" wf_at >"$work/$1.at"
}

# mail_link ADDRESS PAGE — the token of the newest mail to ADDRESS whose link opens PAGE. The
# recovery notice carries two links, so the walk names the page rather than taking the first one.
mail_link() {
  local address=$1 page=$2 id
  id=$(curl -sS "$MAILPIT/api/v1/messages?limit=200" | jq -r --arg to "$address" \
    '[.messages[] | select(any(.To[]; .Address == $to))][0].ID // empty')
  [[ -n $id ]] || fail "no mail to $address"
  curl -sS "$MAILPIT/api/v1/message/$id" | jq -r .Text |
    grep -o "${page}#token=[^[:space:]]*" | head -1 | cut -d= -f2-
}

mail_subject() {
  local id
  id=$(curl -sS "$MAILPIT/api/v1/messages?limit=200" | jq -r --arg to "$1" \
    '[.messages[] | select(any(.To[]; .Address == $to))][0].ID // empty')
  [[ -n $id ]] || fail "no mail to $1"
  curl -sS "$MAILPIT/api/v1/message/$id" | jq -r .Subject
}

# A condition for wait_for: re-evaluated on every poll, unlike a command substitution.
mail_arrived() { [[ $(mail_count "$1" "$2") -ge 1 ]]; }
recovery_status() { identity_sql "SELECT status FROM account_recoveries WHERE id = '$1'"; }
status_is() { [[ $(recovery_status "$1") == "$2" ]]; }

# nudge_job — asks the running identity to run `account-recoveries-advance` now rather than at its
# next quarter hour. The job itself reads the clock; the walk moves the row's instead.
nudge_job() {
  (cd "$repo_root/services/identity" && node "$repo_root/services/gateway/scripts/nudge-job.mjs" \
    identity-jobs account-recoveries-advance) >/dev/null
}

reset_local_state
stamp=$(date +%s)
owner_email="owner-recovery-$stamp@example.com"
new_email="owner-recovery-$stamp-new@example.com"
owner_password='correct horse battery'

step '0. sign in as the two staff, and make a verified owner'
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
seed_dev
login admin admin@wayfare.test "$seed_password"
login super "$BOOTSTRAP_SUPER_ADMIN_EMAIL" "$BOOTSTRAP_SUPER_ADMIN_PASSWORD"
call owner-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d "$(body --arg e "$owner_email" --arg p "$owner_password" \
    '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
cookie_value owner-register wf_at >"$work/owner.at"
json owner-register .data.user.id >"$work/owner.id"
owner_id=$(cat "$work/owner.id")
# A verified owner is the only kind of account this flow recovers (rdm-spec I-14).
identity_sql "UPDATE users SET is_email_verified = true, owner_verified_at = now() WHERE id = '$owner_id'" >/dev/null
echo "✓ owner $owner_email is verified"

step '1. the admin opens a case, and the refusals hold'
call open 201 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BUSINESS_DETAILS_MATCH"], supportReference: "TICKET-1"}')"
recovery_id=$(json open .data.recovery.id)
[[ $(json open .data.recovery.status) == PENDING_APPROVAL ]] || fail 'the case is not PENDING_APPROVAL'
echo "✓ 201 PENDING_APPROVAL, case $recovery_id"

call thin 422 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK"], supportReference: "T"}')"
call no-callback 422 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" \
    '{requestedEmail: $e, evidenceCodes: ["BUSINESS_DETAILS_MATCH", "BILLING_KNOWLEDGE"], supportReference: "T"}')"
call second 409 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BILLING_KNOWLEDGE"], supportReference: "T"}')"
[[ $(json second .error.details.status) == RECOVERY_ALREADY_LIVE ]] || fail 'a second live case is not refused as such'
tourist_id=$(identity_sql "SELECT id FROM users WHERE email = 'tourist@wayfare.test'")
call not-owner 409 -X POST "$BASE/admin/users/$tourist_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BILLING_KNOWLEDGE"], supportReference: "T"}')"
[[ $(json not-owner .error.details.status) == NOT_AN_OWNER ]] || fail 'a tourist is not refused as NOT_AN_OWNER'
echo '✓ one code → 422, no callback → 422, a second case → 409, a tourist → 409 NOT_AN_OWNER'

step '2. the queue shows it'
call queue 200 "$BASE/admin/email-recoveries?status=PENDING_APPROVAL" "${console[@]}" -b "$(as admin)"
[[ $(json queue "[.data[] | select(.id == \"$recovery_id\")] | length") == 1 ]] || fail 'the case is not in the queue'
echo "✓ the queue lists it among $(json queue '.meta.total') case(s)"

step '3. nobody approves their own case; the super admin approves this one'
# An `ADMIN` cannot approve anything: the permission is excluded from the role, so the gateway
# refuses before identity is asked.
call admin-approve 403 -X POST "$BASE/admin/email-recoveries/$recovery_id/approve" "${console[@]}" -b "$(as admin)"
[[ $(json admin-approve .error.code) == PERMISSION_DENIED ]] || fail 'an ADMIN was not refused the approval permission'
# And a super admin who opened a case cannot approve that one either — identity's four-eyes rule,
# with the database's check behind it. A second owner keeps the one-live index out of the way.
call owner2-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d "$(body --arg e "owner2-recovery-$stamp@example.com" --arg p "$owner_password" \
    '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
owner2_id=$(json owner2-register .data.user.id)
identity_sql "UPDATE users SET is_email_verified = true, owner_verified_at = now() WHERE id = '$owner2_id'" >/dev/null
call open-by-super 201 -X POST "$BASE/admin/users/$owner2_id/email-recoveries" "${console[@]}" -b "$(as super)" \
  -d "$(body --arg e "owner2-recovery-$stamp-new@example.com" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BILLING_KNOWLEDGE"], supportReference: "TICKET-0"}')"
call self-approve 403 -X POST "$BASE/admin/email-recoveries/$(json open-by-super .data.recovery.id)/approve" \
  "${console[@]}" -b "$(as super)"
[[ $(json self-approve .error.code) == RECOVERY_SELF_APPROVAL ]] || fail 'the opener is not refused as RECOVERY_SELF_APPROVAL'
echo '✓ an ADMIN → 403 PERMISSION_DENIED; the super admin on their own case → 403 RECOVERY_SELF_APPROVAL'
# Nothing about the recovery reached the owner between opening and approval.
[[ $(mail_count "$owner_email" 'recover') == 0 ]] || fail 'the owner heard about the recovery before approval'
[[ $(identity_sql "SELECT count(*) FROM notifications WHERE recipient_user_id = '$owner_id'") == 0 ]] ||
  fail 'the bell rang before approval'
echo '✓ nothing about the recovery sent before approval'

call approve 200 -X POST "$BASE/admin/email-recoveries/$recovery_id/approve" "${console[@]}" -b "$(as super)"
[[ $(json approve .data.recovery.status) == ON_HOLD ]] || fail 'the case is not ON_HOLD'
hold_until=$(json approve .data.recovery.holdUntil)
[[ -n $hold_until && $hold_until != null ]] || fail 'the hold has no end'
wait_for 'the hold notice reached the old address' 15 mail_arrived "$owner_email" 'recovering access'
cancel_token=$(mail_link "$owner_email" '/recovery/cancel')
[[ -n $cancel_token ]] || fail 'the hold notice carries no cancel link'
echo "✓ ON_HOLD until $hold_until, notice to the old address with its cancel link"
[[ $(identity_sql "SELECT count(*) FROM notifications WHERE recipient_user_id = '$owner_id' AND type = 'ACCOUNT_RECOVERY_PENDING'") == 1 ]] ||
  fail 'the bell says nothing'
# Nothing about the account has changed.
[[ $(identity_sql "SELECT email FROM users WHERE id = '$owner_id'") == "$owner_email" ]] || fail 'the address changed at the hold'
[[ $(identity_sql "SELECT credentials_changed_at IS NULL FROM users WHERE id = '$owner_id'") == t ]] ||
  fail 'the credentials were stamped at the hold'
echo '✓ the bell shows it, and the account is untouched'

step '4. the owner stops it'
call cancel 204 -X POST "$BASE/account-recoveries/$recovery_id/cancel" "${console[@]}" \
  -d "$(body --arg t "$cancel_token" '{token: $t}')"
[[ $(recovery_status "$recovery_id") == CANCELLED ]] || fail 'the case is not CANCELLED'
call cancel-again 410 -X POST "$BASE/account-recoveries/$recovery_id/cancel" "${console[@]}" \
  -d "$(body --arg t "$cancel_token" '{token: $t}')"
[[ $(identity_sql "SELECT count(*) FROM audit_logs WHERE action = 'ACCOUNT_RECOVERY_CANCELLED_BY_OWNER'") -ge 1 ]] ||
  fail 'the cancellation left no audit row'
echo '✓ CANCELLED with an audit row; the same token again → 410'

# A signed-in owner needs no token at all.
call open-2 201 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BILLING_KNOWLEDGE"], supportReference: "TICKET-2"}')"
second_id=$(json open-2 .data.recovery.id)
call cancel-signed-in 204 -X POST "$BASE/account-recoveries/$second_id/cancel" "${console[@]}" -b "$(as owner)" -d '{}'
[[ $(recovery_status "$second_id") == CANCELLED ]] || fail 'the signed-in owner could not cancel'
echo '✓ the signed-in owner cancels their own case without a token'

step '5. a third case, approved, and the hold pushed into the past'
call open-3 201 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$new_email" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BUSINESS_DETAILS_MATCH"], supportReference: "TICKET-3"}')"
third_id=$(json open-3 .data.recovery.id)
call approve-3 200 -X POST "$BASE/admin/email-recoveries/$third_id/approve" "${console[@]}" -b "$(as super)"
# The job takes an explicit `now`; here the clock is moved instead, which is the same thing.
identity_sql "UPDATE account_recoveries SET hold_until = now() - interval '1 minute' WHERE id = '$third_id'" >/dev/null
nudge_job
wait_for 'the job sent the link' 60 status_is "$third_id" LINK_SENT
complete_token=$(mail_link "$new_email" '/recovery/complete')
[[ -n $complete_token ]] || fail 'the requested address got no completion link'
echo "✓ LINK_SENT, and the link went to $new_email"

step '6. completion moves the account'
call complete 204 -X POST "$BASE/account-recoveries/complete" "${console[@]}" \
  -d "$(body --arg t "$complete_token" '{token: $t, newPassword: "a brand new password"}')"
[[ $(recovery_status "$third_id") == COMPLETED ]] || fail 'the case is not COMPLETED'
[[ $(identity_sql "SELECT email FROM users WHERE id = '$owner_id'") == "$new_email" ]] || fail 'the address did not move'
[[ $(identity_sql "SELECT is_email_verified AND credentials_changed_at IS NOT NULL FROM users WHERE id = '$owner_id'") == t ]] ||
  fail 'the new address is not verified, or the credentials were not stamped'
[[ $(identity_sql "SELECT count(*) FROM sessions WHERE user_id = '$owner_id' AND revoked_at IS NULL") == 0 ]] ||
  fail 'a session survived the recovery'
echo '✓ COMPLETED: the address moved and was verified, every session ended'

# The old session is refused, and the new password signs in at the new address.
call old-session 401 "$BASE/users/me" "${console[@]}" -b "$(as owner)"
login recovered "$new_email" 'a brand new password'
call me 200 "$BASE/users/me" "${console[@]}" -b "$(as recovered)"
[[ $(json me .data.user.email) == "$new_email" ]] || fail '/users/me does not show the new address'
echo '✓ the old session is refused; the owner signs in at the new address'

step '7. a fourth case, expired by the clock'
call open-4 201 -X POST "$BASE/admin/users/$owner_id/email-recoveries" "${console[@]}" -b "$(as admin)" \
  -d "$(body --arg e "$owner_email" \
    '{requestedEmail: $e, evidenceCodes: ["PHONE_CALLBACK", "BILLING_KNOWLEDGE"], supportReference: "TICKET-4"}')"
fourth_id=$(json open-4 .data.recovery.id)
identity_sql "UPDATE account_recoveries SET expires_at = now() - interval '1 minute' WHERE id = '$fourth_id'" >/dev/null
nudge_job
wait_for 'the job expired the case' 60 status_is "$fourth_id" EXPIRED
[[ $(identity_sql "SELECT cancel_token_hash IS NULL FROM account_recoveries WHERE id = '$fourth_id'") == t ]] ||
  fail 'an expired case kept its cancel token'
[[ $(identity_sql "SELECT count(*) FROM audit_logs WHERE action = 'ACCOUNT_RECOVERY_EXPIRED'") -ge 1 ]] ||
  fail 'the expiry left no audit row'
echo '✓ EXPIRED by the job, its token cleared, with an audit row'

step 'done'
printf '\n✓ walk-recovery: every step passed\n'
