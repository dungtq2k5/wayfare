#!/bin/sh
# Round 40's analytics on the phone (§3.3), each Maestro run time-limited. From any directory:
#   sh apps/mobile/.maestro/analytics/system.sh
# Needs the local stack with analytics, `pnpm mobile:reverse`, a Diagnostics build, an English
# phone. Each flow starts from a fresh install, so it leaves the app at a finished first run.
set -e
cd "$(dirname "$0")"
. ../common/stack-ready.sh
. ../common/animations.sh
FONT=$(adb shell settings get system font_scale)
trap 'animations_back; adb shell settings put system font_scale "$FONT"' EXIT

MAESTRO_TIMEOUT=600 maestro test analytics.yaml
MAESTRO_TIMEOUT=600 maestro test no-thanks.yaml
MAESTRO_TIMEOUT=600 maestro test new-policy.yaml
MAESTRO_TIMEOUT=900 maestro test sabotage.yaml

adb shell settings put system font_scale 2.0
MAESTRO_TIMEOUT=600 maestro test screens-large.yaml
adb shell settings put system font_scale "$FONT"
