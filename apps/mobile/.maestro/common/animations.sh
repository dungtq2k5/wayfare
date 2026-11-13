# Sourced by each feature's system.sh: the phone's animations off while the flows run, and its own
# scales back at the end. A spinner turns until its work is done, and Maestro waits for a still
# screen before every step, so with animations on each tap would wait out its settle timeout.
# With them off the app's spinners stand still (its reduced-motion form) and the flows keep pace.
ANIMATION_KEYS='window_animation_scale transition_animation_scale animator_duration_scale'
ANIMATIONS=$(for key in $ANIMATION_KEYS; do adb shell settings get global "$key"; done | tr '\n' ' ')
animations_back() {
  set -- $ANIMATIONS
  for key in $ANIMATION_KEYS; do
    adb shell settings put global "$key" "$1"
    shift
  done
}
for key in $ANIMATION_KEYS; do adb shell settings put global "$key" 0; done

# Every `maestro test` of a system run: a stale driver on the phone, left by a run that was
# stopped, is stopped first, and a run that hangs (a driver that never answers) ends after
# MAESTRO_TIMEOUT seconds instead of holding the run for hours. A timed-out run fails the script.
maestro() {
  adb shell am force-stop dev.mobile.maestro > /dev/null 2>&1 || true
  adb shell am force-stop dev.mobile.maestro.test > /dev/null 2>&1 || true
  sleep 2
  local status=0
  timeout -k 30 "${MAESTRO_TIMEOUT:-900}" maestro "$@" || status=$?
  [ "$status" -eq 124 ] && echo "maestro: timed out after ${MAESTRO_TIMEOUT:-900}s: $*" >&2
  return "$status"
}
