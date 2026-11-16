#!/bin/bash
# Continue with Google's sabotage run (round 31a), part by part: the edges that need the API or the
# databases first — an account never confirmed, one verified, one under an address Google does not
# own, a staff address, an account linked to another Google account — and the gateway unreachable
# and the largest text. Every part resets the sign-in budget. Needs the local stack on
# GOOGLE_ISSUER=fake (`pnpm mobile:reverse`), its Mailpit, a Diagnostics build in English; restores
# the phone and deletes the run's accounts at the end.
#   bash apps/mobile/.maestro/account/google-system.sh
set -e
cd "$(dirname "$0")"
. ../common/animations.sh

API=http://localhost:13000/api/v1
TS=$(date +%s)
A="unconfirmed-${TS}@example.com"
B="verified-${TS}@example.com"
C="not-google-${TS}@example.com"
D="google-only-${TS}@example.com"
E="large-${TS}@example.com"
LINKED="linked-elsewhere-${TS}@example.com"
STAFF=superadmin@wayfare.local
PASSWORD=lantern-river-82

FONT=$(adb shell settings get system font_scale)
LOCATION=$(adb shell settings get secure location_mode)
restore() {
  animations_back
  adb reverse tcp:13000 tcp:13000 > /dev/null
  adb shell settings put system font_scale "$FONT"
  adb shell settings put secure location_mode "$LOCATION"
  for account in "$B" "$C" "$LINKED"; do erase "$account" || true; done
}
trap restore EXIT

api() {
  curl -sS -H 'content-type: application/json' -H 'x-wayfare-client: mobile' \
    -H 'x-wayfare-app-version: 0.1.0' "$@"
}
psql_identity() { docker exec wayfare-identity-db psql -U wayfare -d wayfare_identity -qtAc "$1"; }
token() { python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["accessToken"])'; }
register() {
  api -o /dev/null -X POST "$API/auth/register" -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\",\"preferredLocale\":\"en\",\"termsVersion\":\"2026-09-01\"}"
}
verify() { psql_identity "UPDATE users SET is_email_verified = true WHERE email = '$1'"; }
erase() {
  local access
  access=$(api -X POST "$API/auth/login" -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | token 2> /dev/null) || return 1
  api -o /dev/null -X DELETE "$API/users/me" -H "authorization: Bearer $access" \
    -d "{\"currentPassword\":\"$PASSWORD\",\"confirm\":\"DELETE\"}"
}
fresh() {
  local key
  for key in $(docker exec wayfare-redis redis-cli --scan --pattern 'rl:AUTH*'); do
    docker exec wayfare-redis redis-cli DEL "$key" > /dev/null
  done
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
fresh
register "$A"
register "$B" && verify "$B"
register "$C" && verify "$C"
# An account already linked to another Google account (a subject no pick here mints).
register "$LINKED" && verify "$LINKED"
psql_identity "INSERT INTO user_identities (id, user_id, provider, subject, email_at_link) SELECT gen_random_uuid(), id, 'GOOGLE', 'another-google-account', email FROM users WHERE email = '$LINKED'"

echo '== fake-google-on'
maestro test steps/fake-google-on.yaml
part google-failures STAFF="$STAFF" LINKED="$LINKED"
part google-removed A="$A"
# The removal's email, and the old password refused.
mail=$(curl -sS "http://localhost:8025/api/v1/search?query=to:$A" | python3 -c 'import json,sys; print(" | ".join(m["Subject"] for m in json.load(sys.stdin)["messages"]))')
echo "mail to A: $mail"
case "$mail" in *"Your Wayfare password was removed"*) ;; *) echo 'FAILED: no removal email'; exit 1 ;; esac
status=$(api -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -d "{\"email\":\"$A\",\"password\":\"$PASSWORD\"}")
echo "A's old password: $status"
[ "$status" = 401 ] || { echo 'FAILED: the old password still works'; exit 1; }
part google-linked B="$B"
part google-password-step C="$C" PASSWORD="$PASSWORD"
part google-only D="$D"

# Edge 3: the gateway unreachable, from a cold start.
adb reverse --remove tcp:13000
adb shell am force-stop app.wayfare
part google-offline
adb reverse tcp:13000 tcp:13000 > /dev/null

# Edge 10: the largest text, a new Google-only account through to its deletion.
adb shell settings put system font_scale 2.0
echo '== fake-google-on'
maestro test steps/fake-google-on.yaml
part google-only D="$E"
adb shell settings put system font_scale "$FONT"
echo "== done"
