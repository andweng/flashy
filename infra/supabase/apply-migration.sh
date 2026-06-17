#!/usr/bin/env bash
# Apply the Flashy initial schema to a running self-hosted Supabase Postgres.
# Run on the VM after `docker compose up -d` and after the db container is healthy.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/supabase/docker}"
MIGRATION="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../supabase/migrations" && pwd)/0001_initial_schema.sql}"

if [[ ! -f "$MIGRATION" ]]; then
  echo "Migration file not found: $MIGRATION" >&2
  exit 1
fi

echo ">> Applying $MIGRATION to the Supabase 'db' container..."
cd "$COMPOSE_DIR"
docker compose exec -T db psql -U postgres -d postgres < "$MIGRATION"
echo ">> Done."
