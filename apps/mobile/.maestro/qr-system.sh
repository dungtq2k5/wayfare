#!/bin/sh
# The parts of the QR sabotage run that need adb or the admin API (Maestro cannot reach them):
# offline, a removed Place, a cold link, the largest text, and a link before the first run.
#   sh apps/mobile/.maestro/qr-system.sh
# Needs the local stack and the super admin of `bootstrap:super-admin`. Restores everything it
# changes, even on a failure.
set -e
cd "$(dirname "$0")"
API=http://localhost:13000/api/v1
JAR=$(mktemp)
FONT=$(adb shell settings get system font_scale)
CODE=SCT7J6K3
PLACE=$(docker exec wayfare-catalog-db psql -U wayfare -d wayfare_catalog -Atc \
  "SELECT id FROM places WHERE public_code = '$CODE'")
console() { curl -sS -b "$JAR" -c "$JAR" -H 'x-wayfare-client: console' -H 'content-type: application/json' "$@"; }
restore() {
  adb reverse tcp:13000 tcp:13000 > /dev/null
  adb shell settings put system font_scale "$FONT"
  console -o /dev/null -X POST "$API/admin/places/$PLACE/restore" || true
  rm -f "$JAR"
}
trap restore EXIT
links() {
  adb shell pm grant app.wayfare android.permission.CAMERA
  adb shell pm set-app-links-user-selection --user 0 --package app.wayfare true all
}

# Offline (edge 4): the gateway out of reach, a cold start; then back, Try again.
adb reverse --remove tcp:13000
adb shell am force-stop app.wayfare
maestro test qr-offline.yaml
adb reverse tcp:13000 tcp:13000 > /dev/null
maestro test qr-online-again.yaml

# A removed Place (edge 8): soft-deleted through the admin API; a cold start syncs it away.
console -o /dev/null -X POST "$API/auth/login" \
  -d '{"email":"superadmin@wayfare.local","password":"super admin pass 1"}'
console -o /dev/null -w '%{http_code}\n' -X DELETE "$API/admin/places/$PLACE"
adb shell am force-stop app.wayfare
maestro test qr-removed.yaml
console -o /dev/null -X POST "$API/admin/places/$PLACE/restore"

# A cold link (edge 7): back closes the sheet onto the Map; back again leaves the app.
adb shell am force-stop app.wayfare
maestro test qr-cold.yaml
adb shell input keyevent KEYCODE_BACK
sleep 2
if adb shell dumpsys activity activities | grep -q 'mResumedActivity.*app.wayfare'; then
  echo 'back on the Map did not leave the app'
  exit 1
fi

# The largest text (edge 9).
adb shell settings put system font_scale 2.0
maestro test qr-large-text.yaml
adb shell settings put system font_scale "$FONT"

# A link before the first run (L3): the code waits through the language picker and the notice.
adb shell pm clear app.wayfare > /dev/null
links
adb shell am start -a android.intent.action.VIEW -d https://wayfare.app/p/QK4V1TCX > /dev/null
maestro test qr-first-run.yaml
echo 'qr-system: every step passed'
