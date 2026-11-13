#!/usr/bin/env bash
# Live walk of the taxonomy's administration against a running stack (identity, catalog, billing,
# gateway): as the super admin, categories — a new one, a taken code, an edit, a deactivation that
# existing Places survive and an owner can still edit through — then areas — a new one, an overlap,
# a boundary that would leave Places outside, and a deactivation refused while Places are live.
# Uses http://localhost only.
#
# Usage: services/gateway/scripts/walk-taxonomy.sh
#   Needs `pnpm seed:dev` run once (both pilot areas, their Places, the Vĩnh Khánh owners) and
#   SEED_ACCOUNT_PASSWORD in services/identity/.env. Leaves `walk-d3` and `WALK_BAKERY` inactive;
#   a second run reactivates and reuses them. BASE and ROOT may be overridden.
set -euo pipefail

ROOT=${ROOT:-http://localhost:13000}
BASE=${BASE:-$ROOT/api/v1}
export BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}
export BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}
work=$(mktemp -d)
cleanup() {
  # Best-effort: a failed walk leaves every seeded category and area as the seed made them.
  if [[ -f $work/admin.at ]]; then
    for code in MARKET STREET_FOOD; do
      id=$(category_id "$code" 2>/dev/null || true)
      [[ -n ${id:-} ]] && curl -sS -o /dev/null -X PATCH "$BASE/admin/categories/$id" \
        "${console[@]}" -b "$(admin)" -d '{"isActive":true}' || true
    done
    [[ -f $work/d1.ring ]] && curl -sS -o /dev/null -X PATCH "$BASE/admin/areas/$d1_id" \
      "${console[@]}" -b "$(admin)" -d "{\"boundary\":$(cat "$work/d1.ring")}" || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
# shellcheck source=./walk-lib.sh
source "$(dirname "$0")/walk-lib.sh"

seed_password=$(grep -E '^SEED_ACCOUNT_PASSWORD=.+' "$repo_root/services/identity/.env" | cut -d= -f2- || true)
[[ -n $seed_password ]] || fail 'set SEED_ACCOUNT_PASSWORD in services/identity/.env (the Vĩnh Khánh owners)'

admin() { echo "wf_at=$(cat "$work/admin.at")"; }
owner() { echo "wf_at=$(cat "$work/owner.at")"; }
category_id() {
  curl -sS "$BASE/admin/categories" "${console[@]}" -b "$(admin)" |
    jq -r --arg c "$1" '.data[] | select(.code == $c) | .id'
}
area_id() {
  curl -sS "$BASE/admin/areas" "${console[@]}" -b "$(admin)" |
    jq -r --arg c "$1" '.data[] | select(.code == $c) | .id'
}
public_codes() { curl -sS "$BASE/$1" -H 'x-wayfare-client: console' | jq -r '[.data[].code] | join(",")'; }
# box WEST SOUTH EAST NORTH — a closed GeoJSON Polygon.
box() {
  jq -nc --argjson w "$1" --argjson s "$2" --argjson e "$3" --argjson n "$4" \
    '{type: "Polygon", coordinates: [[[$w, $s], [$e, $s], [$e, $n], [$w, $n], [$w, $s]]]}'
}

reset_local_state
stamp=$(date +%s)
d1_id=$(jq -r .id "$repo_root/services/catalog/prisma/seed/pilot-d1/area.json")
d4_code=$(jq -r .code "$repo_root/services/catalog/prisma/seed/pilot-d4/area.json")
ben_thanh=$(jq -r '.[] | select(.slug == "cho-ben-thanh") | .id' \
  "$repo_root/services/catalog/prisma/seed/pilot-d1/places.json")
venue=$(jq -r '.venues[] | select(.slug == "oc-mau-a") | .id' \
  "$repo_root/services/catalog/prisma/seed/pilot-d4/venues.json")
owner_email=$(jq -r '.owners[] | select(.slug == "owner-1") | .email' \
  "$repo_root/services/identity/prisma/seed/pilot-d4/owners.json")

step '0. sign in as the super admin and as a Vĩnh Khánh owner'
(cd "$repo_root" && pnpm --silent --filter @wayfare/identity bootstrap:super-admin) | tail -1
call admin-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$BOOTSTRAP_SUPER_ADMIN_EMAIL" --arg p "$BOOTSTRAP_SUPER_ADMIN_PASSWORD" '{email: $e, password: $p}')"
cookie_value admin-login wf_at >"$work/admin.at"
call owner-login 200 -X POST "$BASE/auth/login" "${console[@]}" \
  -d "$(body --arg e "$owner_email" --arg p "$seed_password" '{email: $e, password: $p}')"
cookie_value owner-login wf_at >"$work/owner.at"

step '1. categories: the list with counts; create WALK_BAKERY; a taken code'
call categories 200 "$BASE/admin/categories" "${console[@]}" -b "$(admin)"
[[ $(json categories '[.data[] | select(.code == "MARKET")][0].placeCount') -ge 1 ]] ||
  fail 'MARKET has no Place count'
echo "✓ $(json categories '.data | length') categories, MARKET used by $(json categories '[.data[] | select(.code == "MARKET")][0].placeCount')"
bakery=$(category_id WALK_BAKERY)
if [[ -z $bakery ]]; then
  call bakery-create 201 -X POST "$BASE/admin/categories" "${console[@]}" -b "$(admin)" \
    -d '{"code":"WALK_BAKERY","appliesTo":"VENUE","icon":"bakery","sortOrder":110}'
  bakery=$(json bakery-create .data.category.id)
else
  call bakery-reactivate 200 -X PATCH "$BASE/admin/categories/$bakery" "${console[@]}" -b "$(admin)" \
    -d '{"isActive":true}'
fi
call bakery-taken 400 -X POST "$BASE/admin/categories" "${console[@]}" -b "$(admin)" \
  -d '{"code":"WALK_BAKERY","appliesTo":"VENUE","icon":"bakery","sortOrder":110}'
[[ $(json bakery-taken '.error.details.issues[0].path') == /code ]] || fail 'the taken code is not at /code'
echo '✓ a taken code is 400 at /code'

step '2. change its icon and order; the public list shows it at once'
call bakery-edit 200 -X PATCH "$BASE/admin/categories/$bakery" "${console[@]}" -b "$(admin)" \
  -d "{\"icon\":\"bakery-$((stamp % 1000))\",\"sortOrder\":115}"
[[ $(public_codes categories) == *WALK_BAKERY* ]] || fail 'GET /categories does not list WALK_BAKERY'
echo '✓ GET /categories lists WALK_BAKERY (the cache applies to clients and CDNs, not the gateway)'

step '3. deactivate MARKET and STREET_FOOD: existing Places keep them, new choices refuse them'
market=$(category_id MARKET)
street=$(category_id STREET_FOOD)
call market-off 200 -X PATCH "$BASE/admin/categories/$market" "${console[@]}" -b "$(admin)" -d '{"isActive":false}'
call street-off 200 -X PATCH "$BASE/admin/categories/$street" "${console[@]}" -b "$(admin)" -d '{"isActive":false}'
[[ $(catalog_sql "SELECT c.code FROM places p JOIN categories c ON c.id = p.category_id WHERE p.id = '$ben_thanh'") == MARKET ]] ||
  fail 'Bến Thành lost MARKET'
echo '✓ Bến Thành keeps MARKET'
[[ $(public_codes categories) != *MARKET* ]] || fail 'GET /categories still lists MARKET'
echo '✓ GET /categories no longer lists MARKET'
call market-create 404 -X POST "$BASE/admin/places" "${console[@]}" -b "$(admin)" -d "$(body '{
    nameVi: "Chợ thử", descriptionVi: "Một chợ thử của bài đi bộ.", categoryCode: "MARKET",
    location: {lat: 10.7765, lng: 106.7005}, triggerRadiusM: 40, narrationPriority: 50,
    photos: [], openingHours: [], requestActivation: false}')"
[[ $(json market-create .error.details.resource) == CATEGORY ]] || fail 'not RESOURCE_NOT_FOUND { CATEGORY }'
echo '✓ an admin create with MARKET is 404 RESOURCE_NOT_FOUND { CATEGORY }'
call venue-read 200 "$BASE/owner/places/$venue" "${console[@]}" -b "$(owner)"
payload=$(cd "$repo_root/services/catalog" && node -e '
  const { loadPilotD4, payloadOf } = require("./dist/prisma/seed/pilot-d4.seed");
  const venue = loadPilotD4().venues.find((row) => row.id === process.argv[1]);
  process.stdout.write(JSON.stringify({ ...payloadOf(venue), phone: "+84909990001" }));' "$venue")
call phone-edit 201 -X POST "$BASE/owner/submissions" "${console[@]}" -b "$(owner)" \
  -d "$(jq -nc --arg v "$venue" --arg h "$(json venue-read .data.editableHash)" --argjson p "$payload" \
    '{kind: "UPDATE", placeId: $v, baseEditableHash: $h, payload: $p}')"
echo '✓ the owner of a STREET_FOOD Venue still submits a phone-only edit'
call phone-withdraw 200 -X POST "$BASE/owner/submissions/$(json phone-edit .data.submission.id)/withdraw" \
  "${console[@]}" -b "$(owner)"
call market-on 200 -X PATCH "$BASE/admin/categories/$market" "${console[@]}" -b "$(admin)" -d '{"isActive":true}'
call street-on 200 -X PATCH "$BASE/admin/categories/$street" "${console[@]}" -b "$(admin)" -d '{"isActive":true}'
call bakery-off 200 -X PATCH "$BASE/admin/categories/$bakery" "${console[@]}" -b "$(admin)" -d '{"isActive":false}'

step '4. areas: the list with counts; create walk-d3 in District 3'
call areas 200 "$BASE/admin/areas" "${console[@]}" -b "$(admin)"
echo "✓ $(json areas '[.data[] | "\(.code): \(.placeCounts.PROCESSING + .placeCounts.ACTIVE) live"] | join(", ")')"
walk_d3=$(area_id walk-d3)
if [[ -z $walk_d3 ]]; then
  call d3-create 201 -X POST "$BASE/admin/areas" "${console[@]}" -b "$(admin)" -d "$(jq -nc \
    --argjson b "$(box 106.683 10.776 106.689 10.782)" \
    '{code: "walk-d3", nameVi: "Khu thử Quận 3", boundary: $b, center: {lat: 10.779, lng: 106.686},
      defaultZoom: 16, sortOrder: 90, isActive: true}')"
  walk_d3=$(json d3-create .data.area.id)
else
  call d3-reactivate 200 -X PATCH "$BASE/admin/areas/$walk_d3" "${console[@]}" -b "$(admin)" -d '{"isActive":true}'
fi
[[ $(public_codes areas) == *walk-d3* ]] || fail 'GET /areas does not list walk-d3'
echo '✓ walk-d3 is on GET /areas'

step '5. the same box moved 0.012° east, into District 1 → 409 AREA_OVERLAPS'
call overlap 409 -X POST "$BASE/admin/areas" "${console[@]}" -b "$(admin)" -d "$(jq -nc \
  --argjson b "$(box 106.695 10.776 106.701 10.782)" \
  '{code: "walk-overlap", nameVi: "Khu chồng lấn", boundary: $b, center: {lat: 10.779, lng: 106.698},
    defaultZoom: 16, sortOrder: 91, isActive: true}')"
[[ $(json overlap '.error | "\(.code) \(.details.codes | join(","))"') == 'AREA_OVERLAPS hcmc-d1-core' ]] ||
  fail "not AREA_OVERLAPS { codes: ['hcmc-d1-core'] }"
echo "✓ AREA_OVERLAPS { codes: ['hcmc-d1-core'] }"

step '6. shrink hcmc-d1-core past Bến Thành → 409; widen it; restore it'
call d1-read 200 "$BASE/admin/areas/$d1_id" "${console[@]}" -b "$(admin)"
json d1-read .data.area.boundary >"$work/d1.ring"
call d1-shrink 409 -X PATCH "$BASE/admin/areas/$d1_id" "${console[@]}" -b "$(admin)" \
  -d "{\"boundary\":$(box 106.699 10.768 106.709 10.7845)}"
[[ $(json d1-shrink .error.code) == AREA_EXCLUDES_PLACES ]] || fail 'not AREA_EXCLUDES_PLACES'
[[ $(json d1-shrink ".error.details.placeIds | index(\"$ben_thanh\") != null") == true ]] ||
  fail 'Bến Thành is not among the excluded Places'
call d1-unchanged 200 "$BASE/admin/areas/$d1_id" "${console[@]}" -b "$(admin)"
[[ $(json d1-unchanged .data.area.boundary) == "$(cat "$work/d1.ring")" ]] || fail 'the boundary changed'
echo "✓ AREA_EXCLUDES_PLACES { count: $(json d1-shrink .error.details.count) }, nothing changed"
call d1-widen 200 -X PATCH "$BASE/admin/areas/$d1_id" "${console[@]}" -b "$(admin)" \
  -d "{\"boundary\":$(box 106.6925 10.768 106.709 10.785)}"
call d1-restore 200 -X PATCH "$BASE/admin/areas/$d1_id" "${console[@]}" -b "$(admin)" \
  -d "{\"boundary\":$(cat "$work/d1.ring")}"
rm "$work/d1.ring"

step '7. deactivate walk-d3; hcmc-d4-vinh-khanh → 409 AREA_HAS_LIVE_PLACES'
call d3-off 200 -X PATCH "$BASE/admin/areas/$walk_d3" "${console[@]}" -b "$(admin)" -d '{"isActive":false}'
[[ $(public_codes areas) != *walk-d3* ]] || fail 'GET /areas still lists walk-d3'
echo '✓ walk-d3 is gone from GET /areas'
call d4-off 409 -X PATCH "$BASE/admin/areas/$(area_id "$d4_code")" "${console[@]}" -b "$(admin)" \
  -d '{"isActive":false}'
echo "✓ $(json d4-off '.error | "\(.code) { count: \(.details.count) }"')"

step '8. the audit trail'
# audited ACTION MIN — identity holds at least MIN rows of ACTION from this run.
audited() {
  [[ $(identity_sql "SELECT count(*) FROM audit_logs WHERE action = '$1' AND occurred_at > to_timestamp($stamp)") -ge $2 ]]
}
wait_for 'the area edits reach the audit log' 10 audited AREA_UPDATED 3
wait_for 'the category edits reach the audit log' 10 audited CATEGORY_UPDATED 6

printf '\n✓ taxonomy walk complete\n'
