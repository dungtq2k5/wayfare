#!/bin/sh
# Round 40's Android analytics states as screenshots, named after their frames, Light and Dark
# (AC1 also at 200 %), into analytics/screenshots/ for the designer's review. From any directory:
#   sh apps/mobile/.maestro/analytics/screens.sh
set -e
cd "$(dirname "$0")"
. ../common/animations.sh
FONT=$(adb shell settings get system font_scale)
OUT=/tmp/wayfare-maestro-40
rm -rf "$OUT" && mkdir -p "$OUT"
trap 'animations_back; adb shell settings put system font_scale "$FONT"; adb shell cmd uimode night auto' EXIT

for THEME in light dark; do
  if [ "$THEME" = dark ]; then adb shell cmd uimode night yes; else adb shell cmd uimode night no; fi
  MAESTRO_TIMEOUT=600 maestro test --test-output-dir="$OUT" -e THEME=$THEME screens.yaml
done

adb shell cmd uimode night no
adb shell settings put system font_scale 2.0
MAESTRO_TIMEOUT=600 maestro test --test-output-dir="$OUT" screens-large.yaml
adb shell settings put system font_scale "$FONT"

mkdir -p screenshots
find "$OUT" -name 'ac*.png' -exec cp {} screenshots/ \;
ls screenshots
