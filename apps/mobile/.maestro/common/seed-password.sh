# Sourced by a system.sh: the password the run's accounts are made with, the local stack's seed
# password (services/identity/.env), never one written into a script.
PASSWORD=$(sed -n 's/^SEED_ACCOUNT_PASSWORD=//p' "$(git rev-parse --show-toplevel)/services/identity/.env")
[[ -n "$PASSWORD" ]] || { echo 'SEED_ACCOUNT_PASSWORD is empty in services/identity/.env' >&2; exit 1; }
