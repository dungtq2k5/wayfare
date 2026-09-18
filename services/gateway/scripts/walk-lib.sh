#!/usr/bin/env bash
# Shared by the live walks: HTTP calls with expected statuses, cookies, local state, and Mailpit.
# Sourced, never run. Expects BASE and `work` (a temp directory) to be set by the walk.

MAILPIT=${MAILPIT:-http://localhost:8025}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
console=(-H 'x-wayfare-client: console' -H 'content-type: application/json')

step() { printf '\n== %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*"; exit 1; }

# call NAME EXPECTED_STATUS curl-args… — stores the body in $work/NAME.json and headers in $work/NAME.h
call() {
  local name=$1 want=$2
  shift 2
  local got
  got=$(curl -sS -o "$work/$name.json" -D "$work/$name.h" -w '%{http_code}' "$@")
  if [[ "$got" != "$want" ]]; then
    printf '✗ %s: HTTP %s (wanted %s)\n' "$name" "$got" "$want"
    cat "$work/$name.json"
    echo
    exit 1
  fi
  printf '✓ %s: HTTP %s\n' "$name" "$got"
}

json() { jq -r "$2" "$work/$1.json"; }
cookie_value() { grep -i "^set-cookie: $2=" "$work/$1.h" | head -1 | sed -E "s/^[^=]*=([^;]*).*/\1/" | tr -d '\r'; }
body() { jq -nc "$@"; }

# Local only: a walk starts with an empty mail catcher and fresh rate-limit buckets, so earlier
# runs neither feed it stale mail nor exhaust the AUTH bucket.
reset_local_state() {
  curl -sS -o /dev/null -X DELETE "$MAILPIT/api/v1/messages" || fail 'Mailpit is not reachable'
  (cd "$repo_root" && docker compose exec -T redis sh -c \
    "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null)
  echo '✓ Mailpit emptied, rate limits reset'
}

# mail_token ADDRESS SUBJECT_REGEX — waits up to 5 s for the newest matching mail to ADDRESS and
# prints the token in its link fragment.
mail_token() {
  local address=$1 subject=$2 id attempt
  for attempt in $(seq 1 25); do
    id=$(curl -sS "$MAILPIT/api/v1/messages?limit=200" | jq -r --arg to "$address" --arg re "$subject" \
      '[.messages[] | select(any(.To[]; .Address == $to)) | select(.Subject | test($re))][0].ID // empty')
    [[ -n $id ]] && break
    sleep 0.2
  done
  [[ -n $id ]] || fail "no mail to $address matching /$subject/"
  curl -sS "$MAILPIT/api/v1/message/$id" | jq -r .Text | grep -o '#token=[^[:space:]]*' | head -1 | cut -d= -f2-
}

# mail_count ADDRESS SUBJECT_REGEX — how many matching mails ADDRESS has.
mail_count() {
  curl -sS "$MAILPIT/api/v1/messages?limit=200" | jq --arg to "$1" --arg re "$2" \
    '[.messages[] | select(any(.To[]; .Address == $to)) | select(.Subject | test($re))] | length'
}

# expect_refused WHO TOKEN — waits up to 2 s for an access token to be refused.
expect_refused() {
  local who=$1 token=$2 status attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/users/me" "${console[@]}" -b "wf_at=$token")
    [[ $status == 401 ]] && break
    sleep 0.2
  done
  [[ $status == 401 ]] || fail "$who's old access token still works after 2 s (HTTP $status)"
  echo "✓ $who's old access token is refused after $((attempt * 200)) ms or less"
}

# catalog_sql SQL — runs SQL against the local catalog database and prints the bare result.
catalog_sql() {
  (cd "$repo_root" && docker compose exec -T catalog-db \
    psql -U wayfare -d wayfare_catalog -At -v ON_ERROR_STOP=1 -c "$1")
}

# ready_event PLACE_ID LANG HASH [AUDIO_HASH|none] — a `narration.localization.ready` payload,
# shaped by the contracts' own fixture (the built package).
ready_event() {
  local audio=${4:-$3}
  (cd "$repo_root/packages/contracts" && node -e '
    const [placeId, lang, sourceContentHash, audio] = process.argv.slice(1);
    const { localizationReadyFixture } = require("./dist/testing");
    process.stdout.write(JSON.stringify(localizationReadyFixture({
      placeId, lang, sourceContentHash, name: `Walk place (${lang})`,
      audioContentHash: audio === "none" ? null : audio,
    })));' "$1" "$2" "$3" "$audio")
}

# publish SUBJECT PAYLOAD — publishes to the local JetStream through nats-box, deduplicated by the
# payload's eventId as the outbox relay would.
publish() {
  local id
  id=$(jq -r .eventId <<<"$2")
  (cd "$repo_root" && docker compose --profile tools run --rm -T nats-box \
    nats pub "$1" "$2" -H "Nats-Msg-Id:$id" >/dev/null 2>&1) || fail "could not publish $1"
  echo "✓ published $1 ($id)"
}

# catalog_node SCRIPT ARGS… — runs a script with catalog's dependencies (sharp, qrcode) available.
catalog_node() {
  local script=$1
  shift
  (cd "$repo_root/services/catalog" && node -e "$script" "$@")
}

# seed_dev — `pnpm seed:dev` (idempotent: a few seconds when nothing changed); its report is kept
# in $work/seed.log and the walk stops if it fails.
seed_dev() {
  (cd "$repo_root" && pnpm --silent seed:dev >"$work/seed.log" 2>&1) || {
    tail -30 "$work/seed.log"
    fail 'pnpm seed:dev failed'
  }
  echo "✓ pnpm seed:dev — $(grep -Eo '[0-9]+ Places — .*' "$work/seed.log" | tail -1)"
}

# The seeded pilot area's id, from the committed corpus.
pilot_area_id() { jq -r .id "$repo_root/services/catalog/prisma/seed/pilot-d1/area.json"; }

# walk_location INDEX — a point for this run's INDEX-th Place: a strip along the pilot area's
# northern edge, at least 300 m from every corpus Place, offset by the run's stamp so runs never
# stack their Places on one spot. Prints `lat lng` (with a decimal point, whatever the locale).
walk_location() {
  LC_ALL=C awk -v stamp="$stamp" -v i="$1" \
    'BEGIN { printf "%.6f %.6f\n", 10.7835 - 0.0002 * i, 106.6940 + (stamp % 140) * 0.0001 }'
}

# remember_place ID — a Place this walk created, deleted again by forget_places.
remember_place() { echo "$1" >>"$work/walk-places"; }

# forget_places — deletes every Place this walk created (a walk leaves no test Place on the demo
# map). Best-effort: it also runs from the EXIT trap after a failure.
forget_places() {
  [[ -f $work/walk-places && -f $work/admin.at ]] || return 0
  local id
  while read -r id; do
    curl -sS -o /dev/null -X DELETE "$BASE/admin/places/$id" "${console[@]}" -b "wf_at=$(cat "$work/admin.at")" || true
  done <"$work/walk-places"
  rm -f "$work/walk-places"
}

# The console sockets a walk opens, stopped by its EXIT trap.
socket_pids=()

# socket NAME TOKEN [JOB_ID] — a console socket recording its frames to $work/NAME.frames.
socket() {
  (cd "$repo_root/services/gateway" && TOKEN=$2 WS_URL="$ROOT/ws" exec \
    node scripts/walk-socket.mjs "$work/$1.frames" ${3:+"$3"}) &
  socket_pids+=($!)
}

# frames NAME JQ — the recorded frames of a socket, filtered.
frames() { [[ -f $work/$1.frames ]] && jq -sc "$2" "$work/$1.frames" || echo '[]'; }

# wait_for WHAT SECONDS COMMAND… — polls COMMAND until it succeeds.
wait_for() {
  local what=$1 seconds=$2 attempt
  shift 2
  for attempt in $(seq 1 $((seconds * 5))); do
    "$@" >/dev/null 2>&1 && { echo "✓ $what"; return; }
    sleep 0.2
  done
  fail "$what: not within $seconds s"
}

# saw NAME EVENT — whether socket NAME has received EVENT (a wait_for condition).
saw() { [[ $(frames "$1" "[.[] | select(.event == \"$2\")] | length") -ge 1 ]]; }
