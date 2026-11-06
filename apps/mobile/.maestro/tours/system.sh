#!/bin/sh
# Round 39's tours on the phone (§3.4), each Maestro run time-limited. From any directory:
#   STOP_CATALOG=... START_CATALOG=... sh apps/mobile/.maestro/tours/system.sh
# Needs what walk/walk.yaml needs, and leaves the app at its first run (TM6c clears it); the offline steps need District 1 downloaded in Settings first
# and Vĩnh Khánh not.
set -e
cd "$(dirname "$0")"
. ../common/animations.sh
FONT=$(adb shell settings get system font_scale)
trap 'animations_back; adb shell settings put system font_scale "$FONT"; adb reverse tcp:13000 tcp:13000' EXIT

maestro test tours.yaml
GONE=$(cd ../../../.. && node apps/mobile/.maestro/tours/setup.mjs | sed 's/.*"gone":"\([A-Z0-9]*\)".*/\1/')
MAESTRO_TIMEOUT=300 maestro test -e GONE_CODE="$GONE" links.yaml

adb reverse --remove tcp:13000
sleep 15
MAESTRO_TIMEOUT=300 maestro test steps/offline-whole.yaml
MAESTRO_TIMEOUT=300 maestro test steps/offline-not-downloaded.yaml
adb reverse tcp:13000 tcp:13000

adb shell settings put system font_scale 2.0
MAESTRO_TIMEOUT=300 maestro test steps/large-text.yaml
adb shell settings put system font_scale "$FONT"

# TM6c last: it clears the app's data (a phone that has never synced). STOP_CATALOG and
# START_CATALOG stop and start the local catalog service, so the first run's sync fails.
sh -c "$STOP_CATALOG"
MAESTRO_TIMEOUT=300 maestro test steps/first-run-unsynced.yaml
adb reverse --remove tcp:13000
sh -c "$START_CATALOG"
MAESTRO_TIMEOUT=300 maestro test steps/never-synced.yaml
