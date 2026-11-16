#!/bin/sh
# Two failed-read states on Android as screenshots, Light and Dark, into tours/screenshots/ for the
# designer's review: the Map and Explore when the first sync failed with nothing on the phone, and
# a tour on the phone, now below two live stops, opened while the gateway can't be reached. From
# any directory, with the local stack and its host services up:
#   STOP_CATALOG=... START_CATALOG=... sh apps/mobile/.maestro/tours/screens-unreachable.sh
# The first-run flow clears the app's data: District 1 must be downloaded again for system.sh.
set -e
cd "$(dirname "$0")"
. ../common/stack-ready.sh
. ../common/animations.sh
OUT=/tmp/wayfare-maestro-unreachable
STATE=/tmp/wayfare-stale-tour.json
rm -rf "$OUT" && mkdir -p "$OUT"
trap 'animations_back; adb shell cmd uimode night auto; adb reverse tcp:13000 tcp:13000; sh -c "$START_CATALOG"' EXIT

for THEME in light dark; do
  if [ "$THEME" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  # The first sync fails: catalog is stopped, the gateway answers.
  sh -c "$STOP_CATALOG"
  maestro test --test-output-dir="$OUT" -e THEME=$THEME -e SHOT=yes steps/first-run-unsynced.yaml
  sh -c "$START_CATALOG"
  . ../common/stack-ready.sh
  # The gateway reconnects to catalog with a backoff after its restart: wait until it answers.
  waited=0
  until curl -sf -H 'x-wayfare-client: web' http://localhost:13000/api/v1/areas > /dev/null; do
    [ "$waited" -ge 60 ] && { echo "the gateway doesn't reach catalog after 60 s" >&2; exit 1; }
    sleep 2
    waited=$((waited + 2))
  done

  # A tour the phone syncs, then a stop taken down and synced again: the phone holds it below two.
  CODE=$(cd ../../../.. && node apps/mobile/.maestro/tours/stale-tour.mjs make $STATE)
  MAESTRO_TIMEOUT=120 maestro test steps/launch.yaml
  (cd ../../../.. && node apps/mobile/.maestro/tours/stale-tour.mjs down $STATE)
  # The change reaches the sync feed by event a few seconds later.
  sleep 20
  MAESTRO_TIMEOUT=120 maestro test steps/launch.yaml
  adb reverse --remove tcp:13000
  MAESTRO_TIMEOUT=120 maestro test --test-output-dir="$OUT" -e THEME=$THEME -e SHOT=yes \
    -e TOUR_CODE="$CODE" steps/tour-unreachable.yaml
  adb reverse tcp:13000 tcp:13000
  (cd ../../../.. && node apps/mobile/.maestro/tours/stale-tour.mjs restore $STATE)
done

mkdir -p screenshots
find "$OUT" \( -name 'map-sync-failed-*.png' -o -name 'explore-sync-failed-*.png' -o -name 'tour-failed-read-*.png' \) -exec cp {} screenshots/ \;
ls screenshots | rg 'sync-failed|failed-read'
