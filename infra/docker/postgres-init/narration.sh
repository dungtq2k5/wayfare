#!/bin/bash
# Creates the narration service's test and shadow databases beside the working one
# (ADR 0011). Runs only when the data volume is empty.
set -euo pipefail

for db in wayfare_narration_test wayfare_narration_shadow; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE $db OWNER "$POSTGRES_USER";
SQL
done
