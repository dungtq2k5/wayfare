#!/usr/bin/env bash
# Live walk of the device and session flows against a running stack (identity + gateway).
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: services/gateway/scripts/walk-sessions.sh     (BASE and APP_VERSION may be overridden)
set -euo pipefail

BASE=${BASE:-http://localhost:3000/api/v1}
APP_VERSION=${APP_VERSION:-1.0.0}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mobile=(-H 'x-wayfare-client: mobile' -H "x-wayfare-app-version: $APP_VERSION" -H 'content-type: application/json')
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
claims() { cut -d. -f2 <<<"$1" | tr '_-' '/+' | base64 -d 2>/dev/null || true; }

device_body='{"platform":"ANDROID","appVersion":"'"$APP_VERSION"'","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}'

step '1. register a device'
call device-register 201 -X POST "$BASE/devices" "${mobile[@]}" -d "$device_body"
device_id=$(json device-register .data.deviceId)
device_secret=$(json device-register .data.deviceSecret)
[[ $(json device-register .data.accessToken) != null ]] || fail 'no accessToken'
[[ $(json device-register .data.expiresIn) == 900 ]] || fail 'expiresIn is not 900'

step '2. exchange its secret'
call device-token 200 -X POST "$BASE/devices/token" "${mobile[@]}" \
  -d '{"deviceId":"'"$device_id"'","deviceSecret":"'"$device_secret"'"}'
device_token=$(json device-token .data.accessToken)

step '3. PATCH /devices/me'
call device-patch 200 -X PATCH "$BASE/devices/me" "${mobile[@]}" -H "authorization: Bearer $device_token" \
  -d '{"contentLocale":"ja"}'

step '4. forget it, then exchange and PATCH again'
call device-forget 204 -X DELETE "$BASE/devices/me" "${mobile[@]}" -H "authorization: Bearer $device_token"
call device-token-after 401 -X POST "$BASE/devices/token" "${mobile[@]}" \
  -d '{"deviceId":"'"$device_id"'","deviceSecret":"'"$device_secret"'"}'
[[ $(json device-token-after .error.code) == DEVICE_REVOKED ]] || fail 'exchange after forget is not DEVICE_REVOKED'
call device-patch-after 401 -X PATCH "$BASE/devices/me" "${mobile[@]}" -H "authorization: Bearer $device_token" -d '{}'
[[ $(json device-patch-after .error.code) == DEVICE_REVOKED ]] || fail 'PATCH after forget is not DEVICE_REVOKED'

step '5. register a console user'
email="walk-$(date +%s)@example.com"
password='correct horse battery'
call console-register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d '{"email":"'"$email"'","password":"'"$password"'","preferredLocale":"en","termsVersion":"2026-09-01"}'
[[ $(json console-register '.data | keys | join(",")') == user ]] || fail 'the console body carries more than { user }'
access=$(cookie_value console-register wf_at)
refresh_old=$(cookie_value console-register wf_rt)
[[ -n $access && -n $refresh_old ]] || fail 'register set no wf_at / wf_rt cookies'

step '6. GET /users/me'
call me 200 "$BASE/users/me" "${console[@]}" -b "wf_at=$access"
[[ $(json me .data.user.email) == "$email" ]] || fail 'GET /users/me answered another account'

step '7. refresh'
call refresh 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$refresh_old"
refresh_new=$(cookie_value refresh wf_rt)
[[ -n $refresh_new && $refresh_new != "$refresh_old" ]] || fail 'refresh did not rotate the cookie'

step '8. replay the old value within 10 s, again after 11 s, then the new value'
call replay-race 409 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$refresh_old"
[[ $(json replay-race .error.details.status) == ROTATED ]] || fail 'the race answer is not INVALID_STATE / ROTATED'
! grep -qi '^set-cookie:' "$work/replay-race.h" || fail 'a lost race must not touch the cookies'
sleep 11
call replay 401 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$refresh_old"
call replay-successor 401 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$refresh_new"

step '9. log in again'
call console-login 200 -X POST "$BASE/auth/login" "${console[@]}" -d '{"email":"'"$email"'","password":"'"$password"'"}'

step '10. log in from a new device with its bearer'
call device2-register 201 -X POST "$BASE/devices" "${mobile[@]}" -d "$device_body"
device2_id=$(json device2-register .data.deviceId)
device2_token=$(json device2-register .data.accessToken)
call mobile-login 200 -X POST "$BASE/auth/login" "${mobile[@]}" -H "authorization: Bearer $device2_token" \
  -d '{"email":"'"$email"'","password":"'"$password"'"}'
account_token=$(json mobile-login .data.accessToken)
[[ $(json mobile-login .data.refreshToken) != null ]] || fail 'the mobile body carries no refreshToken'
did=$(claims "$account_token" | jq -r .did)
[[ $did == "$device2_id" ]] || fail "the token's did is $did, not $device2_id"
echo "✓ did = $device2_id"

step '11. log out everywhere, then reuse the old access token'
call logout-all 204 -X POST "$BASE/auth/logout/all" "${mobile[@]}" -H "authorization: Bearer $account_token"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  status=$(curl -sS -o "$work/after.json" -w '%{http_code}' "$BASE/users/me" "${mobile[@]}" -H "authorization: Bearer $account_token")
  [[ $status == 401 ]] && break
  sleep 0.2
done
[[ $status == 401 ]] || fail "the old access token still works after 2 s (HTTP $status)"
echo "✓ the old access token is refused after $((attempt * 200)) ms or less"

printf '\nAll steps passed.\n'
