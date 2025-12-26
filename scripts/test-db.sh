#!/usr/bin/env bash
set -euo pipefail

compose_file="docker-compose.test.yml"
project_name="nightfall-test"

cleanup() {
  docker compose -p "$project_name" -f "$compose_file" down -v
}

trap cleanup EXIT

docker compose -p "$project_name" -f "$compose_file" up -d

for _ in {1..30}; do
  if docker compose -p "$project_name" -f "$compose_file" exec -T db pg_isready -U nightfall -d nightfall >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker compose -p "$project_name" -f "$compose_file" exec -T db pg_isready -U nightfall -d nightfall >/dev/null 2>&1; then
  echo "Postgres did not become ready" >&2
  exit 1
fi

# Additional wait for PostGIS extensions to fully initialize
sleep 2

export DATABASE_URL="postgresql://nightfall:nightfall@localhost:5433/nightfall?sslmode=disable"

pnpm run db:up
node scripts/check-db.mjs
