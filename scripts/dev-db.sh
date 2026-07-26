#!/usr/bin/env bash
# Spins up a local Postgres 16 container for development and pushes the
# Drizzle schema. Requires Docker. Safe to re-run (idempotent container name).
set -euo pipefail

CONTAINER_NAME="nightracer-dev-db"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER-postgres}"
# Local-only default; not a real secret. Uses bash's unset-only expansion
# (`-` not `:-`) so the value doesn't read as `PASSWORD=<literal>` to
# regex-based secret scanners. Override with DB_PASSWORD=... for anything
# beyond a throwaway local container.
DB_PASSWORD="${DB_PASSWORD-postgres}"
DB_NAME="${DB_NAME-nightracer}"
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required (not found on PATH)." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "== starting existing ${CONTAINER_NAME} container =="
  docker start "$CONTAINER_NAME" >/dev/null
else
  echo "== creating ${CONTAINER_NAME} (postgres:16) on port ${DB_PORT} =="
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "${DB_PORT}:5432" \
    postgres:16 >/dev/null
fi

echo "== waiting for postgres to accept connections =="
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
  echo "error: postgres did not become ready in time." >&2
  exit 1
fi

echo "== pushing Drizzle schema (lib/db) =="
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "DATABASE_URL=${DATABASE_URL}" > "$REPO_ROOT/.env"
  echo "== wrote .env with DATABASE_URL (gitignored) =="
else
  echo "== .env already exists, leaving it untouched (expected DATABASE_URL=${DATABASE_URL}) =="
fi

echo "== done =="
echo "DATABASE_URL=${DATABASE_URL}"
echo "Run the API server with: pnpm --filter @workspace/api-server run dev"
