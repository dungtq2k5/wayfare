#!/bin/bash
# Creates the billing service's test and shadow databases beside the working one
# (ADR 0011). Runs only when the data volume is empty.
set -euo pipefail

for db in wayfare_billing_test wayfare_billing_shadow; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE $db OWNER "$POSTGRES_USER";
SQL
done
