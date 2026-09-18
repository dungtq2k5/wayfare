#!/usr/bin/env bash
# Live walk of owner verification against a running stack (identity, gateway, NATS, Redis,
# Mailpit): a verified user applies, a content moderator reviews, only an admin reveals the
# national ID, approval turns the applicant into an owner, a rejected applicant applies again, and
# a pending application is withdrawn. Uses http://localhost only: curl never sends a Secure cookie
# to 127.0.0.1.
#
# Usage: services/gateway/scripts/walk-owner-registration.sh
#   Needs SEED_ACCOUNT_PASSWORD in services/identity/.env, so `pnpm seed:dev` creates
#   moderator@wayfare.test. BASE, ROOT and the BOOTSTRAP_SUPER_ADMIN_* variables may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:3000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
cleanup() {
  for pid in "${socket_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

password='correct horse battery'
agreement=$(cd "$repo_root/packages/contracts" && node -e \
  'process.stdout.write(require("./dist").LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT)')
seed_password=$(grep -E '^SEED_ACCOUNT_PASSWORD=.+' "$repo_root/services/identity/.env" | cut -d= -f2- || true)
[[ -n $seed_password ]] || fail 'set SEED_ACCOUNT_PASSWORD in services/identity/.env (moderator@wayfare.test)'

# as WHO — the cookie of a signed-in walker.
as() { echo "wf_at=$(cat "$work/$1.at")"; }

# register WHO — a new console account; keeps its access and refresh tokens.
register() {
  call "$1-register" 201 -X POST "$BASE/auth/register" "${console[@]}" \
    -d "$(body --arg e "$(email_of "$1")" --arg p "$password" \
      '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
  cookie_value "$1-register" wf_at >"$work/$1.at"
  cookie_value "$1-register" wf_rt >"$work/$1.rt"
}

# verify WHO — follows the verification mail, then refreshes into a token that says so.
verify() {
  local token
  token=$(mail_token "$(email_of "$1")" 'Confirm your email')
  call "$1-verify" 204 -X POST "$BASE/auth/email/verify" "${console[@]}" -d "$(body --arg t "$token" '{token: $t}')"
  refresh "$1"
}

# refresh WHO — rotates the session and keeps the new tokens.
refresh() {
  call "$1-refresh" 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$(cat "$work/$1.rt")"
  cookie_value "$1-refresh" wf_at >"$work/$1.at"
  cookie_value "$1-refresh" wf_rt >"$work/$1.rt"
}

# login WHO EMAIL PASSWORD — a console session for an existing account.
login() {
  call "$1-login" 200 -X POST "$BASE/auth/login" "${console[@]}" \
    -d "$(body --arg e "$2" --arg p "$3" '{email: $e, password: $p}')"
  cookie_value "$1-login" wf_at >"$work/$1.at"
}

email_of() { echo "walk-$1-$stamp@example.com"; }

# apply NAME WHO STATUS — an application with this run's business name.
apply() {
  call "$1" "$3" -X POST "$BASE/owner/registration" "${console[@]}" -b "$(as "$2")" \
    -d "$(body --arg n "Quán thử $2 $stamp" --arg v "$agreement" '{
      businessName: $n, businessAddress: "12 Lê Lợi, Quận 1", contactName: "Nguyễn Văn An",
      contactPhone: "+84901234567", nationalId: "079 201 001 234", ownerAgreementVersion: $v,
      applicantNote: "The stall at the corner." }')"
}

# audited ACTION RESOURCE_ID — how many audit rows of ACTION name the registration (the audit
# consumer writes them a moment after the commit).
audited() {
  local from to
  from=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
  to=$(date -u -d '+1 second' +%Y-%m-%dT%H:%M:%SZ)
  curl -sS "$BASE/admin/audit-logs?from=$from&to=$to&action=$1&resourceId=$2&limit=100" \
    "${console[@]}" -b "$(as admin)" | jq '.data | length'
}
audited_at_least() { [[ $(audited "$1" "$2") -ge $3 ]]; }

reset_local_state
stamp=$(date +%s)

step '1. two verified applicants and an unverified one; the moderator and the super admin'
seed_dev
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
login admin "$BOOTSTRAP_SUPER_ADMIN_EMAIL" "$BOOTSTRAP_SUPER_ADMIN_PASSWORD"
login moderator moderator@wayfare.test "$seed_password"
for who in a b c; do register "$who"; done
verify a
verify b
a_id=$(json a-register .data.user.id)
echo "✓ applicant A $a_id"

step '2. the unverified user cannot apply'
apply c-apply c 403
[[ $(json c-apply .error.code) == EMAIL_NOT_VERIFIED ]] || fail 'not EMAIL_NOT_VERIFIED'

step '3. A applies with the current agreement; again is a conflict; the row holds ciphertext'
[[ $(identity_sql "SELECT count(*) FROM legal_acceptances WHERE user_id = '$a_id' AND document = 'OWNER_AGREEMENT'") == 0 ]] ||
  fail 'A already accepted the owner agreement'
apply a-apply a 201
reg_a=$(json a-apply .data.registration.id)
[[ $(json a-apply .data.registration.nationalIdLast4) == 1234 ]] || fail 'no last four'
grep -q 079201001234 "$work/a-apply.json" && fail 'the response echoes the national ID'
[[ $(identity_sql "SELECT count(*) FROM legal_acceptances WHERE user_id = '$a_id' AND document = 'OWNER_AGREEMENT' AND version = '$agreement'") == 1 ]] ||
  fail 'the owner agreement acceptance was not recorded'
echo '✓ the owner agreement acceptance is recorded'
apply a-again a 409
[[ $(json a-again .error.code) == REGISTRATION_ALREADY_PENDING ]] || fail 'not REGISTRATION_ALREADY_PENDING'
row=$(identity_sql "SELECT national_id_ciphertext, national_id_last4 FROM owner_registrations WHERE id = '$reg_a'")
[[ $row == v1:* ]] || fail "the ciphertext does not start with v1: ($row)"
[[ $(identity_sql "SELECT count(*) FROM owner_registrations r WHERE r.id = '$reg_a' AND r::text LIKE '%079201001234%'") == 0 ]] ||
  fail 'the row holds the plaintext'
[[ $(identity_sql "SELECT count(*) FROM outbox_events WHERE payload::text LIKE '%079201001234%'") == 0 ]] ||
  fail 'an outbox event holds the plaintext'
echo "✓ stored as ${row:0:12}… with last four ${row##*|}; no plaintext in the row or the outbox"

step '4. the moderator finds it in the queue and reads the detail'
call queue 200 "$BASE/admin/owner-registrations?q=$(jq -rn --arg q "a $stamp" '$q|@uri')" "${console[@]}" -b "$(as moderator)"
[[ $(json queue '.data[0].id') == "$reg_a" ]] || fail 'the queue does not list it first'
call detail 200 "$BASE/admin/owner-registrations/$reg_a" "${console[@]}" -b "$(as moderator)"
[[ $(json detail .data.nationalIdLast4) == 1234 ]] || fail 'the detail lacks the last four'
grep -q 079201001234 "$work/detail.json" && fail 'the detail shows the full national ID'
[[ $(json detail .data.applicant.emailVerified) == true ]] || fail 'the applicant summary is wrong'
echo "✓ •••• $(json detail .data.nationalIdLast4), applicant $(json detail .data.applicant.email)"

step '5. only an admin reveals the number, never cached, audited every time'
call reveal-moderator 403 -X POST "$BASE/admin/owner-registrations/$reg_a/national-id/reveal" "${console[@]}" -b "$(as moderator)"
call reveal 200 -X POST "$BASE/admin/owner-registrations/$reg_a/national-id/reveal" "${console[@]}" -b "$(as admin)"
[[ $(json reveal .data.nationalId) == 079201001234 ]] || fail 'the revealed number is wrong'
grep -qi '^cache-control: private, no-store' "$work/reveal.h" || fail 'reveal is cacheable'
wait_for 'one OWNER_NATIONAL_ID_REVEALED audit row' 5 audited_at_least OWNER_NATIONAL_ID_REVEALED "$reg_a" 1
[[ $(identity_sql "SELECT count(*) FROM audit_logs WHERE metadata::text LIKE '%079201001234%'") == 0 ]] ||
  fail 'an audit row holds the number'

step "6. A's own view has no staff note"
call a-list 200 "$BASE/owner/registration" "${console[@]}" -b "$(as a)"
[[ $(json a-list '.data[0] | has("internalNote")') == false ]] || fail "A's view has internalNote"
echo "✓ A sees $(json a-list '.data[0].status')"

step "7. the moderator approves: A's token is cut off, a refresh makes A an owner, the bell and the mail arrive"
socket a-bell "$(cat "$work/a.at")"
wait_for "A's console socket is connected" 5 saw a-bell connection:ready
old_a=$(cat "$work/a.at")
call approve 200 -X POST "$BASE/admin/owner-registrations/$reg_a/approve" "${console[@]}" -b "$(as moderator)" \
  -d '{"decisionNote":"Welcome aboard.","internalNote":"Called the number."}'
[[ $(json approve .data.registration.status) == APPROVED ]] || fail 'not APPROVED'
wait_for "A's bell rang" 5 saw a-bell notification:new
expect_refused A "$old_a"
refresh a
call a-me 200 "$BASE/users/me" "${console[@]}" -b "$(as a)"
[[ $(json a-me .data.ownerVerified) == true ]] || fail 'A is not a verified owner'
[[ $(json a-me '.data.roles | index("VENUE_OWNER") != null') == true ]] || fail 'A lacks VENUE_OWNER'
echo "✓ A: ownerVerified, roles $(json a-me '.data.roles | join(", ")')"
[[ $(identity_sql "SELECT count(*) FROM outbox_events WHERE subject = 'identity.owner.verified' AND payload->>'userId' = '$a_id'") == 1 ]] ||
  fail 'not exactly one identity.owner.verified'
echo '✓ one identity.owner.verified event'
call a-feed 200 "$BASE/notifications" "${console[@]}" -b "$(as a)"
[[ $(json a-feed '.data[0].type') == OWNER_REGISTRATION_APPROVED ]] || fail 'no approval in the feed'
wait_for 'the outcome mail to A' 5 test "$(mail_count "$(email_of a)" 'owner registration was reviewed')" -ge 1

step '8. B applies; the moderator rejects without a note (400), then with one'
apply b-apply b 201
reg_b=$(json b-apply .data.registration.id)
call reject-bare 400 -X POST "$BASE/admin/owner-registrations/$reg_b/reject" "${console[@]}" -b "$(as moderator)" -d '{}'
call reject 200 -X POST "$BASE/admin/owner-registrations/$reg_b/reject" "${console[@]}" -b "$(as moderator)" \
  -d '{"decisionNote":"The address does not match the licence.","internalNote":"Looked edited."}'

step '9. B sees the note, not the staff note, and applies again'
call b-list 200 "$BASE/owner/registration" "${console[@]}" -b "$(as b)"
[[ $(json b-list '.data[0].decisionNote') == 'The address does not match the licence.' ]] || fail 'B does not see the note'
grep -q 'Looked edited' "$work/b-list.json" && fail 'B sees the staff note'
apply b-again b 201
reg_b2=$(json b-again .data.registration.id)

step '10. B withdraws; again is a conflict'
call withdraw 200 -X POST "$BASE/owner/registration/$reg_b2/withdraw" "${console[@]}" -b "$(as b)"
[[ $(json withdraw .data.registration.status) == WITHDRAWN ]] || fail 'not WITHDRAWN'
call withdraw-again 409 -X POST "$BASE/owner/registration/$reg_b2/withdraw" "${console[@]}" -b "$(as b)"
[[ $(json withdraw-again .error.code) == INVALID_STATE ]] || fail 'not INVALID_STATE'
call withdraw-other 404 -X POST "$BASE/owner/registration/$reg_a/withdraw" "${console[@]}" -b "$(as b)"

printf '\n✓ walk-owner-registration: all steps passed\n'
