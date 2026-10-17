#!/bin/sh
# The parts of the walk's sabotage run that need the phone's own settings (Maestro cannot change
# them). Start a simulated walk with a story playing first (walk/walk.yaml's first steps), then:
#   sh apps/mobile/.maestro/walk/system.sh
set -e
cd "$(dirname "$0")"
. ../common/animations.sh
FONT=$(adb shell settings get system font_scale)
trap 'animations_back; adb shell settings put secure location_mode 3; adb shell settings put system font_scale "$FONT"; adb reverse tcp:13000 tcp:13000' EXIT

adb shell settings put secure location_mode 0
maestro test steps/location-off.yaml
adb shell settings put secure location_mode 3
maestro test steps/location-on.yaml

# Airplane mode does not cut the phone off the gateway while it reaches it over `adb reverse`, so
# the offline walk drops the reverse mapping instead.
adb reverse --remove tcp:13000
sleep 15
maestro test steps/offline.yaml
adb reverse tcp:13000 tcp:13000

adb shell settings put system font_scale 2.0
maestro test steps/large-text.yaml
