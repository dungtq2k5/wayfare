#!/bin/bash
# The account's sabotage run, in order, each part from where the one before left it: the edges a
# flow can drive by itself (sabotage.yaml's parts) and those that need adb, the API or the
# databases — a second device, the network removed, an older terms acceptance, the largest text.
# Before every part the `AUTH` budget (10 sign-in calls per 15 minutes, by IP and by email) is
# reset, since every part runs from one IP. Needs the local stack (`pnpm mobile:reverse`), its
# Mailpit, and the app in English after the first run; restores the phone and deletes the run's
# accounts at the end.
#   bash apps/mobile/.maestro/account/system.sh
set -e
cd "$(dirname "$0")"
. ../common/animations.sh

API=http://localhost:13000/api/v1
TS=$(date +%s)
# A and B mask alike ("a***a@example.com"): only the server can tell them apart (frame L6).
A="anna${TS}a@example.com"
B="alexa${TS}a@example.com"
C="tourist-${TS}@example.com"
B2="moved-${TS}@example.com"
NOBODY="nobody-${TS}@example.com"
PASSWORD=lantern-river-82
NEWPASS=harbour-lamp-47
# A Place the second device saves: Phố đi bộ Nguyễn Huệ.
FAV_PLACE=01a0b373-d3eb-73c0-bd63-bf84794a5ab2
FAV='.*Nguyễn Huệ.*'

FONT=$(adb shell settings get system font_scale)
LOCATION=$(adb shell settings get secure location_mode)
restore() {
  animations_back
  adb reverse tcp:13000 tcp:13000 > /dev/null
  adb shell settings put system font_scale "$FONT"
  adb shell settings put secure location_mode "$LOCATION"
  for account in "$A:$NEWPASS" "$A:$PASSWORD" "$B:$NEWPASS" "$B:$PASSWORD" "$C:$PASSWORD"; do
    erase "${account%%:*}" "${account#*:}" || true
  done
}
trap restore EXIT

api() {
  curl -sS -H 'content-type: application/json' -H 'x-wayfare-client: mobile' \
    -H 'x-wayfare-app-version: 0.1.0' "$@"
}
token() { python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["accessToken"])'; }
register() {
  api -o /dev/null -X POST "$API/auth/register" -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\",\"preferredLocale\":\"en\",\"termsVersion\":\"2026-09-01\"}"
}
erase() {
  local access
  access=$(api -X POST "$API/auth/login" -d "{\"email\":\"$1\",\"password\":\"$2\"}" | token 2> /dev/null) || return 1
  api -o /dev/null -X DELETE "$API/users/me" -H "authorization: Bearer $access" \
    -d "{\"currentPassword\":\"$2\",\"confirm\":\"DELETE\"}"
}
# The AUTH budget, and the device registration's, back to full.
fresh() {
  local keys
  keys=$(docker exec wayfare-redis redis-cli --scan --pattern 'rl:AUTH:*')
  [ -n "$keys" ] && docker exec wayfare-redis redis-cli DEL $keys > /dev/null
  docker exec wayfare-redis redis-cli DEL 'rl:DEVICE_REGISTRATION:ip:::ffff:127.0.0.1' > /dev/null
}
part() {
  local flow=$1
  shift
  fresh
  local args=()
  for pair in "$@"; do args+=(-e "$pair"); done
  echo "== $flow"
  maestro test "${args[@]}" "steps/$flow.yaml"
}

adb shell settings put secure location_mode 0
adb shell pm set-app-links-user-selection --user 0 --package app.wayfare true all
fresh
register "$A"
register "$B"

part create-twice C="$C" A="$A" PASSWORD="$PASSWORD"
part moved A="$A" PASSWORD="$PASSWORD"
part other-account A="$A" B="$B"
fresh
api -o /dev/null -X POST "$API/auth/password/forgot" -d "{\"email\":\"$A\"}"
part reset A="$A" B="$B" NEWPASS="$NEWPASS" NOBODY="$NOBODY"
part change-email B="$B" NEWPASS="$NEWPASS" B2="$B2"
part delete A="$A" NEWPASS="$NEWPASS"

# DoD 4: the API is the second device. It saves a favourite, then signs out on every phone.
part elsewhere-sign-in B="$B" NEWPASS="$NEWPASS"
device=$(api -X POST "$API/devices" -d '{"platform":"ANDROID","appVersion":"0.1.0","contentLocale":"en","privacyPolicyVersion":"2026-09-01"}' | token)
second=$(api -X POST "$API/auth/login" -H "authorization: Bearer $device" -d "{\"email\":\"$B\",\"password\":\"$NEWPASS\"}" | token)
api -o /dev/null -w "second device saves: %{http_code}\n" -X PUT "$API/me/favorites/$FAV_PLACE" -H "authorization: Bearer $second"
part elsewhere-favourite FAV="$FAV"
api -o /dev/null -w "second device signs out everywhere: %{http_code}\n" -X POST "$API/auth/logout/all" -H "authorization: Bearer $second"
part elsewhere-signed-out

# Edge 12: new terms, by making B's acceptance older (the versions are compiled in).
part terms-sign-in B="$B" NEWPASS="$NEWPASS"
docker exec wayfare-identity-db psql -U wayfare -d wayfare_identity -qc \
  "UPDATE legal_acceptances SET version = '2026-08-01' WHERE document = 'TERMS_OF_SERVICE' AND user_id = (SELECT id FROM users WHERE email = '$B')"
part terms

# Edge 3: the gateway unreachable, from a cold start.
adb reverse --remove tcp:13000
adb shell am force-stop app.wayfare
part offline
adb reverse tcp:13000 tcp:13000 > /dev/null

part too-many B="$B"

adb shell settings put system font_scale 2.0
part large-text B="$B" NEWPASS="$NEWPASS"
adb shell settings put system font_scale "$FONT"

part forget B="$B" NEWPASS="$NEWPASS"
echo "== done"
