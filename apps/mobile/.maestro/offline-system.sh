#!/bin/sh
# Offline packs' Maestro run with the parts Maestro cannot do itself: a fresh install, the largest
# text, the network removed and restored, the app killed mid-download, a damaged file, an update
# made through the admin API, another language, and the pack used with no network.
#   sh apps/mobile/.maestro/offline-system.sh
# Needs the local stack (`pnpm mobile:reverse`), a Diagnostics build and the super admin of
# `bootstrap:super-admin`. Each part starts from what the one before left. Restores the network,
# the font scale, location and the Place it edits, even on a failure.
set -e
cd "$(dirname "$0")"
API=http://localhost:13000/api/v1
JAR=$(mktemp)
FONT=$(adb shell settings get system font_scale)
LOCATION=$(adb shell settings get secure location_mode)
CODE=QK4V1TCX
PLACE=$(docker exec wayfare-catalog-db psql -U wayfare -d wayfare_catalog -Atc \
  "SELECT id FROM places WHERE public_code = '$CODE'")
RADIUS=$(docker exec wayfare-catalog-db psql -U wayfare -d wayfare_catalog -Atc \
  "SELECT trigger_radius_m FROM places WHERE public_code = '$CODE'")
console() { curl -sS -b "$JAR" -c "$JAR" -H 'x-wayfare-client: console' -H 'content-type: application/json' "$@"; }
radius() { console -o /dev/null -X PATCH "$API/admin/places/$PLACE/editorial" -d "{\"triggerRadiusM\":$1}"; }
online() { for p in 13000 4443; do adb reverse tcp:$p tcp:$p > /dev/null; done; }
offline() { for p in 13000 4443; do adb reverse --remove tcp:$p; done; }
restore() {
  online
  adb shell settings put system font_scale "$FONT"
  adb shell settings put secure location_mode "$LOCATION"
  radius "$RADIUS" || true
  rm -f "$JAR"
}
trap restore EXIT
grant() {
  adb shell pm grant app.wayfare android.permission.ACCESS_FINE_LOCATION
  adb shell pm grant app.wayfare android.permission.ACCESS_COARSE_LOCATION
}

# A fresh install: the offer not yet shown. The local stack's registration limit (10 an hour from
# one address) is reset first, so the run can be repeated.
# Location services off: Explore lists every Place by area, wherever the test phone is.
adb shell settings put secure location_mode 0
docker exec wayfare-redis redis-cli DEL 'rl:DEVICE_REGISTRATION:ip:::ffff:127.0.0.1' > /dev/null
adb shell pm clear app.wayfare > /dev/null
grant
maestro test language-fresh.yaml

# The largest text (edge 10): the offer, the sheet, the progress, Offline downloads.
adb shell settings put system font_scale 2.0
maestro test offline-large-text.yaml
adb shell settings put system font_scale "$FONT"

# Download twice, pause and resume, cancel in checking, mobile data, no space, a failed file.
maestro test offline-sabotage.yaml

# The network gone mid-download (edge 2): waiting, then on by itself once it is back.
maestro test offline-start.yaml
offline
maestro test offline-waiting.yaml
online
maestro test offline-goes-on.yaml

# Killed mid-download (edge 2, K9): the next launch goes on.
maestro test offline-start.yaml
adb shell am force-stop app.wayfare
maestro test offline-goes-on.yaml

# A damaged file (edge 5): found at the next launch, repaired.
maestro test offline-damage.yaml
adb shell am force-stop app.wayfare
maestro test offline-repair.yaml

# A story from the pack playing, then delete (edge 6); downloaded again for what follows.
maestro test offline-delete-playing.yaml
maestro test offline-download.yaml

# An update (edge 7): a Place edited through the admin API; offline nothing, online the update.
console -o /dev/null -X POST "$API/auth/login" \
  -d '{"email":"superadmin@wayfare.local","password":"super admin pass 1"}'
radius $((RADIUS + 1))
offline
adb shell am force-stop app.wayfare
maestro test offline-update-offline.yaml
online
adb shell am force-stop app.wayfare
maestro test offline-update.yaml
# Automatic on Wi-Fi (frame M3b): a second edit, a cold start, no tap.
radius "$RADIUS"
adb shell am force-stop app.wayfare
maestro test offline-auto.yaml

# Another language (edge 8).
maestro test offline-other-language.yaml

# The pack in use with no network (edge 9), from a cold start; location on, as a tourist's would
# be: Explore's offline note belongs to its list by distance.
adb shell settings put secure location_mode 3
offline
adb shell am force-stop app.wayfare
maestro test offline-in-use.yaml
online
echo "Large-text and in-use screenshots: ~/.maestro/tests/<run>/<flow>/"
