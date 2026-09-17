#!/usr/bin/env bash
# Live walk of the email and account-link flows against a running stack (identity + gateway) with
# Mailpit: verification, password reset, and an address change with its revert.
# Uses http://localhost only: curl never sends a Secure cookie to 127.0.0.1.
#
# Usage: services/gateway/scripts/walk-email.sh     (BASE and MAILPIT may be overridden)
set -euo pipefail

BASE=${BASE:-http://localhost:3000/api/v1}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

stamp=$(date +%s)
email="walk-email-$stamp@example.com"
new_email="walk-email-new-$stamp@example.com"
password='first walk password'
second_password='second walk password'
third_password='third walk password'
login_body() { body --arg e "$1" --arg p "$2" '{email: $e, password: $p}'; }

reset_local_state

step '1. register; the verification mail arrives'
call register 201 -X POST "$BASE/auth/register" "${console[@]}" \
  -d "$(body --arg e "$email" --arg p "$password" '{email: $e, password: $p, preferredLocale: "en", termsVersion: "2026-09-01"}')"
access=$(cookie_value register wf_at)
refresh_token=$(cookie_value register wf_rt)
verify_token=$(mail_token "$email" 'Confirm your email')
echo "✓ verification link read"

step '2. verify, refresh, GET /users/me'
call verify 204 -X POST "$BASE/auth/email/verify" "${console[@]}" -d "$(body --arg t "$verify_token" '{token: $t}')"
call refresh 200 -X POST "$BASE/auth/refresh" "${console[@]}" -b "wf_rt=$refresh_token"
access=$(cookie_value refresh wf_at)
call me 200 "$BASE/users/me" "${console[@]}" -b "wf_at=$access"
[[ $(json me .data.user.isEmailVerified) == true ]] || fail 'the address is not verified'
[[ $(json me .data.user.emailBounced) == false ]] || fail 'emailBounced should be false'

step '3. forgot for the user and for an unknown address'
call forgot 202 -X POST "$BASE/auth/password/forgot" "${console[@]}" -d "$(body --arg e "$email" '{email: $e}')"
call forgot-unknown 202 -X POST "$BASE/auth/password/forgot" "${console[@]}" \
  -d '{"email":"nobody-'"$stamp"'@example.com"}'
reset_token=$(mail_token "$email" 'Reset your')
[[ $(mail_count "nobody-$stamp@example.com" '.') == 0 ]] || fail 'an unknown address got mail'
echo '✓ one reset mail, for the known address only'

step '4. validate the link, then reset'
call validate 200 -X POST "$BASE/auth/password/reset/validate" "${console[@]}" \
  -d "$(body --arg t "$reset_token" '{token: $t}')"
[[ $(json validate .data.purpose) == PASSWORD_RESET ]] || fail 'not a PASSWORD_RESET link'
echo "✓ emailMasked = $(json validate .data.emailMasked)"
call reset 204 -X POST "$BASE/auth/password/reset" "${console[@]}" \
  -d "$(body --arg t "$reset_token" --arg p "$second_password" '{token: $t, newPassword: $p}')"
grep -qi '^set-cookie: wf_at=;' "$work/reset.h" || fail 'the reset did not clear the cookies'

step '5. reuse the token → 410; sign in'
call reset-again 410 -X POST "$BASE/auth/password/reset" "${console[@]}" \
  -d "$(body --arg t "$reset_token" --arg p "$second_password" '{token: $t, newPassword: $p}')"
call login 200 -X POST "$BASE/auth/login" "${console[@]}" -d "$(login_body "$email" "$second_password")"
access=$(cookie_value login wf_at)

step '6. forgot again, keeping that link unused'
curl -sS -o /dev/null -X DELETE "$MAILPIT/api/v1/messages"
call forgot-kept 202 -X POST "$BASE/auth/password/forgot" "${console[@]}" -d "$(body --arg e "$email" '{email: $e}')"
stale_token=$(mail_token "$email" 'Reset your')
call stale-live 200 -X POST "$BASE/auth/password/reset/validate" "${console[@]}" \
  -d "$(body --arg t "$stale_token" '{token: $t}')"

step '7. request an address change; the mail reaches the new address'
call change-wrong 403 -X POST "$BASE/auth/email/change" "${console[@]}" -b "wf_at=$access" \
  -d "$(body --arg e "$new_email" '{newEmail: $e, currentPassword: "not my password"}')"
[[ $(json change-wrong .error.code) == CURRENT_PASSWORD_INCORRECT ]] || fail 'not CURRENT_PASSWORD_INCORRECT'
call change 202 -X POST "$BASE/auth/email/change" "${console[@]}" -b "wf_at=$access" \
  -d "$(body --arg e "$new_email" --arg p "$second_password" '{newEmail: $e, currentPassword: $p}')"
change_token=$(mail_token "$new_email" 'Confirm your new')

step '8. confirm; the old link dies; the old address gets the notice'
call confirm 204 -X POST "$BASE/auth/email/change/confirm" "${console[@]}" \
  -d "$(body --arg t "$change_token" '{token: $t}')"
call stale-dead 410 -X POST "$BASE/auth/password/reset/validate" "${console[@]}" \
  -d "$(body --arg t "$stale_token" '{token: $t}')"
revert_token=$(mail_token "$email" 'was changed')
echo '✓ revert link read from the old address'

step '9. revert; the old session is refused'
call revert 204 -X POST "$BASE/auth/email/change/revert" "${console[@]}" \
  -d "$(body --arg t "$revert_token" '{token: $t}')"
expect_refused 'the session' "$access"

step '10. reset from the restored address, then sign in'
restored_token=$(mail_token "$email" 'Reset your')
[[ $restored_token != "$stale_token" ]] || fail 'the restored address got no new reset link'
call reset-restored 204 -X POST "$BASE/auth/password/reset" "${console[@]}" \
  -d "$(body --arg t "$restored_token" --arg p "$third_password" '{token: $t, newPassword: $p}')"
call login-restored 200 -X POST "$BASE/auth/login" "${console[@]}" -d "$(login_body "$email" "$third_password")"
[[ $(json login-restored .data.user.email) == "$email" ]] || fail 'the account is not back on its old address'

printf '\nAll steps passed.\n'
