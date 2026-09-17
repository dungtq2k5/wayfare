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
