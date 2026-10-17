#!/bin/sh
# The language switch's Maestro run, in order, with the parts Maestro cannot do itself: a fresh
# install, the network removed and restored, the app killed mid-switch, the largest text, and the
# first run in Japanese.
#   sh apps/mobile/.maestro/language/system.sh
# Needs the local stack (`pnpm mobile:reverse`) and a Diagnostics build. Each part starts from what
# the one before left; the offline part starts from a fresh install, so it can be run from there.
# Restores the network, the font scale and location, even on a failure; the app ends in English.
set -e
cd "$(dirname "$0")"
. ../common/animations.sh
FONT=$(adb shell settings get system font_scale)
LOCATION=$(adb shell settings get secure location_mode)
restore() {
  animations_back
  adb reverse tcp:13000 tcp:13000 > /dev/null
  adb shell settings put system font_scale "$FONT"
  adb shell settings put secure location_mode "$LOCATION"
}
trap restore EXIT
grant() {
  adb shell pm grant app.wayfare android.permission.ACCESS_FINE_LOCATION
  adb shell pm grant app.wayfare android.permission.ACCESS_COARSE_LOCATION
}

# A fresh install, so which languages are on the phone is known; then the basic and sabotage flows.
adb shell pm clear app.wayfare > /dev/null
grant
maestro test ../common/language-fresh.yaml
maestro test language.yaml
maestro test sabotage.yaml

# Offline (X5, X6), from a fresh install with only 日本語 on the phone: the gateway out of reach and a
# cold start; back, the switch resumes (edge 3).
adb shell pm clear app.wayfare > /dev/null
grant
maestro test ../common/language-fresh.yaml
maestro test -e NAME='日本語' -e CODE=ja steps/to.yaml
adb reverse --remove tcp:13000
adb shell am force-stop app.wayfare
maestro test steps/offline.yaml
adb reverse tcp:13000 tcp:13000 > /dev/null
maestro test -e NAME='한국어' -e CODE=ko steps/resumed.yaml

# The network gone mid-switch (edge 2): waiting, then complete once it is back.
maestro test -e NAME='Bahasa Melayu' steps/mid-switch.yaml
adb reverse --remove tcp:13000
maestro test steps/dropped.yaml
adb reverse tcp:13000 tcp:13000 > /dev/null
maestro test -e NAME='Bahasa Melayu' -e CODE=ms steps/resumed.yaml

# Killed mid-switch (edge 4): it resumes at the next launch.
maestro test -e NAME='Русский' steps/mid-switch.yaml
adb shell am force-stop app.wayfare
maestro test steps/killed.yaml
maestro test ../common/language-english.yaml

# The largest text (edge 8): Japanese and Thai, location services off so Explore lists every Place
# by area.
adb shell settings put secure location_mode 0
adb shell am force-stop app.wayfare
adb shell settings put system font_scale 2.0
# Maestro keeps the screenshots with each run, under ~/.maestro/tests/<run>/language-large-text/.
maestro test -e NAME='日本語' -e CODE=ja steps/large-text.yaml
maestro test -e NAME='ไทย' -e CODE=th steps/large-text.yaml
adb shell settings put system font_scale "$FONT"
adb shell settings put secure location_mode "$LOCATION"
maestro test ../common/language-english.yaml

# The first run in Japanese (edge 9).
adb shell pm clear app.wayfare > /dev/null
grant
maestro test steps/first-run.yaml
