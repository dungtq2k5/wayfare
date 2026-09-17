#!/usr/bin/env bash
# Live walk of the staff console flows — accounts, roles, locks, the audit log — against a running
# stack (identity + gateway), started from the repository root's compose file.
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: services/gateway/scripts/walk-admin.sh
#   BASE, BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD may be overridden.
#   The bootstrap account must be the only active SUPER_ADMIN (step 7 checks the last-admin rule).
set -euo pipefail

BASE=${BASE:-http://localhost:3000/api/v1}
root=$(cd "$(dirname "$0")/../../.." && pwd)
identity_dir="$root/services/identity"
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

console=(-H 'x-wayfare-client: console' -H 'content-type: application/json')

step() { printf '\n== %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*"; exit 1; }

# call NAME EXPECTED_STATUS curl-args… — stores the body in $work/NAME.json and headers in $work/NAME.h
call() {
  local name=$1 want=$2
  shift 2
  local got
  got=$(curl -sS -o "$work/$name.json" -D "$work/$name.h" -w '%{http_code}' "$@")
  if [[ "$got" != "$want" ]]; then
    printf '✗ %s: HTTP %s (wanted %s)\n' "$name" "$got" "$want"
    cat "$work/$name.json"
    echo
    exit 1
  fi
  printf '✓ %s: HTTP %s\n' "$name" "$got"
}

json() { jq -r "$2" "$work/$1.json"; }
cookie_value() { grep -i "^set-cookie: $2=" "$work/$1.h" | head -1 | sed -E "s/^[^=]*=([^;]*).*/\1/" | tr -d '\r'; }

# The access and refresh cookies of a staff member, kept in $work/<who>.at and .rt.
login() {
  local who=$1 email=$2 password=$3
  call "$who-login" 200 -X POST "$BASE/auth/login" "${console[@]}" \
    -d "$(jq -nc --arg e "$email" --arg p "$password" '{email: $e, password: $p}')"
  cookie_value "$who-login" wf_at >"$work/$who.at"
  cookie_value "$who-login" wf_rt >"$work/$who.rt"
}
refresh() {
  local who=$1
  call "$who-refresh" 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$(cat "$work/$who.rt")"
  cookie_value "$who-refresh" wf_at >"$work/$who.at"
  cookie_value "$who-refresh" wf_rt >"$work/$who.rt"
}
as() { echo "wf_at=$(cat "$work/$1.at")"; }

# Waits up to 2 s for an access token to be refused.
expect_refused() {
  local who=$1 token=$2 status attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/users/me" "${console[@]}" -b "wf_at=$token")
    [[ $status == 401 ]] && break
    sleep 0.2
  done
  [[ $status == 401 ]] || fail "$who's old access token still works after 2 s (HTTP $status)"
  echo "✓ $who's old access token is refused after $((attempt * 200)) ms or less"
}

# The walk's one shortcut until staff get their setup link: a password hashed by identity's own
# helper (built), written straight into the database.
set_password() {
  local email=$1 password=$2 hash
  hash=$(cd "$identity_dir" && node -e \
    "require('./dist/src/modules/tokens/domain/password.js').hashPassword(process.argv[1]).then((h) => console.log(h))" \
    "$password")
  (cd "$root" && printf "UPDATE users SET password_hash = :'hash' WHERE email = :'email';\n" |
    docker compose exec -T identity-db psql -q -v ON_ERROR_STOP=1 -v hash="$hash" -v email="$email" \
      -U wayfare -d wayfare_identity) >/dev/null
  echo "✓ password set for $email"
}

stamp=$(date +%s)
staff_password='staff walk password'

step '1. bootstrap, then log in as the SUPER_ADMIN (A)'
(cd "$root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
login a "$BOOTSTRAP_SUPER_ADMIN_EMAIL" "$BOOTSTRAP_SUPER_ADMIN_PASSWORD"
call a-me 200 "$BASE/users/me" "${console[@]}" -b "$(as a)"
a_id=$(json a-me .data.user.id)
[[ $(json a-me '.data.roles | index("SUPER_ADMIN") != null') == true ]] || fail 'A is not SUPER_ADMIN'

step '2. the catalogue and the roles'
call permissions 200 "$BASE/admin/permissions" "${console[@]}" -b "$(as a)"
[[ $(json permissions '.data[0].group') == OWNER ]] || fail 'the catalogue does not start with OWNER'
call roles 200 "$BASE/admin/roles" "${console[@]}" -b "$(as a)"
admin_role=$(json roles '.data[] | select(.code == "ADMIN") | .id')
super_role=$(json roles '.data[] | select(.code == "SUPER_ADMIN") | .id')
call supers 200 "$BASE/admin/users?roleId=$super_role" "${console[@]}" -b "$(as a)"
[[ $(json supers '[.data[] | select(.isLocked | not)] | length') == 1 ]] ||
  fail 'A must be the only active SUPER_ADMIN for step 7'

step '3. create the custom role Support'
call support 201 -X POST "$BASE/admin/roles" "${console[@]}" -b "$(as a)" \
  -d '{"name":"Support '"$stamp"'","permissionCodes":["user.read","audit.read"]}'
support=$(json support .data.role.id)
echo "✓ code $(json support .data.role.code)"

step '4. create B (Support) and C (ADMIN), set their passwords, log B in'
b_email="walk-b-$stamp@example.com"
c_email="walk-c-$stamp@example.com"
call create-b 201 -X POST "$BASE/admin/users" "${console[@]}" -b "$(as a)" \
  -d '{"email":"'"$b_email"'","fullName":"Walk B","roleIds":["'"$support"'"]}'
b_id=$(json create-b .data.user.id)
call create-c 201 -X POST "$BASE/admin/users" "${console[@]}" -b "$(as a)" \
  -d '{"email":"'"$c_email"'","fullName":"Walk C","roleIds":["'"$admin_role"'"]}'
c_id=$(json create-c .data.user.id)
set_password "$b_email" "$staff_password"
set_password "$c_email" "$staff_password"
login b "$b_email" "$staff_password"

step '5. escalation: the permission check, a grant, a refresh, then the no-escalation rule'
call b-edit-denied 403 -X PUT "$BASE/admin/roles/$support/permissions" "${console[@]}" -b "$(as b)" \
  -d '{"permissionCodes":["user.read","audit.read","user.lock"]}'
[[ $(json b-edit-denied '.error.details.required | join(",")') == role.update ]] ||
  fail 'B was not refused for lacking role.update'
b_old=$(cat "$work/b.at")
call grant-update 200 -X PUT "$BASE/admin/roles/$support/permissions" "${console[@]}" -b "$(as a)" \
  -d '{"permissionCodes":["user.read","audit.read","role.update"]}'
expect_refused B "$b_old"
refresh b
call b-escalate 403 -X PUT "$BASE/admin/roles/$support/permissions" "${console[@]}" -b "$(as b)" \
  -d '{"permissionCodes":["user.read","audit.read","role.update","billing.refund.create"]}'
[[ $(json b-escalate .error.code) == PERMISSION_DENIED ]] || fail 'not PERMISSION_DENIED'
[[ $(json b-escalate '.error.details.required | join(",")') == billing.refund.create ]] ||
  fail "required is $(json b-escalate .error.details.required), not [billing.refund.create]"

step '6. C (ADMIN) may not lock A (SUPER_ADMIN)'
login c "$c_email" "$staff_password"
call c-lock-a 403 -X POST "$BASE/admin/users/$a_id/lock" "${console[@]}" -b "$(as c)" -d '{"reason":"walk"}'
excluded='billing.entitlement.override,billing.plan.manage,billing.refund.create,role.create,role.delete,role.update,user.email.recover.approve,user.role.assign'
[[ $(json c-lock-a '.error.details.required | join(",")') == "$excluded" ]] ||
  fail "required is $(json c-lock-a .error.details.required), not ADMIN_EXCLUDED_PERMISSIONS"

step '7. the last SUPER_ADMIN keeps the role'
call last-admin 409 -X PUT "$BASE/admin/users/$a_id/roles" "${console[@]}" -b "$(as a)" -d '{"roleIds":[]}'
[[ $(json last-admin .error.code) == LAST_SUPER_ADMIN ]] || fail 'not LAST_SUPER_ADMIN'

step '8. removing role.update reaches B within 2 s'
b_old=$(cat "$work/b.at")
call revoke-update 200 -X PUT "$BASE/admin/roles/$support/permissions" "${console[@]}" -b "$(as a)" \
  -d '{"permissionCodes":["user.read","audit.read"]}'
expect_refused B "$b_old"
refresh b
call b-me 200 "$BASE/users/me" "${console[@]}" -b "$(as b)"
[[ $(json b-me '.data.permissions | index("role.update")') == null ]] || fail 'B still lists role.update'
echo "✓ B's permissions: $(json b-me '.data.permissions | join(",")')"

step '9. a lock stops sign-in and refresh; unlock'
call lock-b 204 -X POST "$BASE/admin/users/$b_id/lock" "${console[@]}" -b "$(as a)" -d '{"reason":"walk check"}'
call b-login-locked 403 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(jq -nc --arg e "$b_email" --arg p "$staff_password" '{email: $e, password: $p}')"
[[ $(json b-login-locked .error.code) == ACCOUNT_LOCKED ]] || fail 'not ACCOUNT_LOCKED'
call b-refresh-locked 401 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$(cat "$work/b.rt")"
call unlock-b 204 -X POST "$BASE/admin/users/$b_id/unlock" "${console[@]}" -b "$(as a)"

step '10. deactivate and restore C, sign C out, and a held role cannot be deleted'
call deactivate-c 204 -X DELETE "$BASE/admin/users/$c_id" "${console[@]}" -b "$(as a)" -d '{"reason":"walk"}'
call get-c 200 "$BASE/admin/users/$c_id" "${console[@]}" -b "$(as a)"
[[ $(json get-c .data.deletedAt) != null ]] || fail 'C is not deactivated'
call restore-c 204 -X POST "$BASE/admin/users/$c_id/restore" "${console[@]}" -b "$(as a)"
call signout-c 204 -X DELETE "$BASE/admin/users/$c_id/sessions" "${console[@]}" -b "$(as a)"
call delete-support 409 -X DELETE "$BASE/admin/roles/$support" "${console[@]}" -b "$(as a)"
[[ $(json delete-support .error.code) == ROLE_IN_USE ]] || fail 'not ROLE_IN_USE'
echo "✓ holders: $(json delete-support .error.details.holders)"

step '11. the audit log'
hour_ago=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
long_ago=$(date -u -d '-94 days' +%Y-%m-%dT%H:%M:%SZ)
expected='ROLE_CREATED STAFF_USER_CREATED ROLE_PERMISSIONS_UPDATED USER_LOCKED USER_UNLOCKED USER_DEACTIVATED USER_RESTORED USER_SESSIONS_REVOKED'
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  # The window's end is whole seconds: a moment ahead keeps this second's rows inside it.
  now=$(date -u -d '+1 second' +%Y-%m-%dT%H:%M:%SZ)
  call audit 200 "$BASE/admin/audit-logs?from=$hour_ago&to=$now&limit=100" "${console[@]}" -b "$(as a)" >/dev/null
  missing=$(for action in $expected; do
    [[ $(json audit "[.data[] | select(.action == \"$action\")] | length") -gt 0 ]] || echo "$action"
  done)
  [[ -z $missing ]] && break
  sleep 0.5
done
[[ -z $missing ]] || fail "the audit log lacks: $missing"
sorted=$(json audit '[.data[].occurredAt] as $at | ($at == ($at | sort | reverse))')
[[ $sorted == true ]] || fail 'the audit log is not newest first'
echo "✓ $(json audit '.data | length') rows, newest first: $(json audit '[.data[:5][].action] | join(", ")') …"
call audit-too-long 400 "$BASE/admin/audit-logs?from=$long_ago&to=$now" "${console[@]}" -b "$(as a)"
[[ $(json audit-too-long .error.code) == VALIDATION_FAILED ]] || fail 'not VALIDATION_FAILED'

printf '\nAll steps passed.\n'
