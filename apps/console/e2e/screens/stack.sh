#!/usr/bin/env bash
# The screen baselines' own stack (README.md): `wayfare-screens`, every port moved up by 10000.
#
#   stack.sh up    — empty databases and bucket, migrated, seeded, the services built and running
#   stack.sh down  — stopped, and its volumes removed
#   stack.sh reset — down, then up: the fresh stack every `test:screens` run needs
#
# The host-side steps (migrations, seeds, the bucket, the super admin) run the services' own
# scripts with this stack's addresses; dotenv never overrides a variable already set, so each
# service's .env supplies only the rest.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$repo"
compose=(docker compose -p wayfare-screens -f compose.yaml -f infra/docker/compose.screens.yaml)
infra=(identity-db catalog-db narration-db billing-db redis nats mailpit fake-gcs)
apps=(identity catalog narration billing gateway)
declare -A port=([identity]=25433 [catalog]=25434 [narration]=25435 [billing]=25436)

# A host-side step's addresses for this stack: its database, and the shared Redis, NATS, mail and
# bucket (a seed that boots its service's app connects to them all).
on() {
  env "DATABASE_URL=postgresql://wayfare:wayfare@localhost:${port[$1]}/wayfare_$1?schema=public" \
    REDIS_URL=redis://localhost:26379 NATS_URL=nats://localhost:24222 SMTP_URL=smtp://localhost:21025 \
    IDENTITY_GRPC_URL=localhost:30051 CATALOG_GRPC_URL=localhost:30052 \
    NARRATION_GRPC_URL=localhost:30053 BILLING_GRPC_URL=localhost:30054 \
    GCS_API_ENDPOINT=http://localhost:24443 GCS_PUBLIC_BASE_URL=http://localhost:24443/wayfare-media-local \
    "${@:2}"
}

up() {
  "${compose[@]}" up -d --wait "${infra[@]}"
  pnpm --silent turbo run build --filter='./services/*' --output-logs=errors-only
  for s in "${apps[@]:0:4}"; do
    on "$s" pnpm --silent --filter "@wayfare/$s" db:deploy
  done
  on catalog pnpm --silent --filter @wayfare/catalog storage:setup -- \
    --cors-origin http://localhost:5183
  "${compose[@]}" --profile apps up -d --build --wait "${apps[@]}"
  # turbo.json's order for `pnpm seed:dev`: identity's owners open their billing accounts (by event),
  # billing's plans go on those accounts, and catalog's Venues ask billing for them.
  for s in identity billing narration catalog; do
    on "$s" pnpm --silent --filter "@wayfare/$s" seed:dev
  done
  # The suite's super admin (e2e/support/people.ts), unless the environment names another.
  on identity env \
    "BOOTSTRAP_SUPER_ADMIN_EMAIL=${BOOTSTRAP_SUPER_ADMIN_EMAIL:-superadmin@wayfare.local}" \
    "BOOTSTRAP_SUPER_ADMIN_PASSWORD=${BOOTSTRAP_SUPER_ADMIN_PASSWORD:-super admin pass 1}" \
    pnpm --silent --filter @wayfare/identity bootstrap:super-admin
  echo "✓ wayfare-screens is up: the gateway on :23000, Mailpit on :28025, media on :24443"
}

down() { "${compose[@]}" --profile apps down -v --remove-orphans; }

case "${1:-}" in
  up) up ;;
  down) down ;;
  reset) down && up ;;
  *) echo "usage: $0 up|down|reset" >&2; exit 2 ;;
esac
