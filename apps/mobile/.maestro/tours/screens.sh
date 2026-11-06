#!/bin/sh
# Round 39's Android tour states as screenshots, named after their frames, Light and Dark (TM1 and
# TM3 also at 200 %), into tours/screenshots/ for the designer's review. From any directory:
#   STOP_CATALOG=... START_CATALOG=... sh apps/mobile/.maestro/tours/screens.sh
# Needs what system.sh needs. TM6c clears the app's data, so it runs last: after the script the app
# starts from its first run, and District 1 must be downloaded again for system.sh.
set -e
cd "$(dirname "$0")"
. ../common/animations.sh
FONT=$(adb shell settings get system font_scale)
OUT=/tmp/wayfare-maestro-39
rm -rf "$OUT" && mkdir -p "$OUT"
trap 'animations_back; adb shell settings put system font_scale "$FONT"; adb shell cmd uimode night auto; adb reverse tcp:13000 tcp:13000' EXIT

CODES=$(cd ../../../.. && node apps/mobile/.maestro/tours/setup.mjs)
GONE=$(echo "$CODES" | sed 's/.*"gone":"\([A-Z0-9]*\)".*/\1/')
RUN=$(echo "$CODES" | sed 's/.*"run":"\([a-z0-9]*\)".*/\1/')

for THEME in light dark; do
  if [ "$THEME" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  maestro test --test-output-dir="$OUT" -e THEME=$THEME -e GONE="$GONE" -e RUN="$RUN" screens.yaml
  adb reverse --remove tcp:13000
  sleep 15
  maestro test --test-output-dir="$OUT" -e THEME=$THEME screens-offline.yaml
  adb reverse tcp:13000 tcp:13000
done

adb shell cmd uimode night no
adb shell settings put system font_scale 2.0
maestro test --test-output-dir="$OUT" screens-large.yaml
adb shell settings put system font_scale "$FONT"

# TM6c needs an install whose first sync never landed: STOP_CATALOG and START_CATALOG are the
# commands that stop and start the local catalog service (the stack's own way of running it).
for THEME in light dark; do
  if [ "$THEME" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  sh -c "$STOP_CATALOG"
  maestro test --test-output-dir="$OUT" steps/first-run-unsynced.yaml
  adb reverse --remove tcp:13000
  sh -c "$START_CATALOG"
  maestro test --test-output-dir="$OUT" -e THEME=$THEME -e SHOT=yes steps/never-synced.yaml
  adb reverse tcp:13000 tcp:13000
done

mkdir -p screenshots
find "$OUT" -name 'tm*.png' -exec cp {} screenshots/ \;
ls screenshots
