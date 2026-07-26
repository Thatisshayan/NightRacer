#!/usr/bin/env bash
# Spins up a local Postgres 16 container for development and pushes the
# Drizzle schema. Requires Docker. Idempotent for unchanged config (see
# "config drift" handling below). Documented in README.md -> "Run & Operate".
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
# FORCE_RECREATE=1 ./scripts/dev-db.sh destroys and recreates the container
# (and its data) if it already exists with different config.
FORCE_RECREATE="${FORCE_RECREATE-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Never print/log a full connection string — only the password is sensitive,
# but redact it everywhere we'd otherwise show DATABASE_URL.
redacted_url() {
  echo "postgres://${DB_USER}:****@localhost:${DB_PORT}/${DB_NAME}"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required (not found on PATH)." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  # Postgres env/credentials are only applied at first init, and the port
  # mapping is fixed at container-create time — starting an existing
  # container does NOT reconcile either with the currently requested
  # DB_PORT/DB_USER/DB_PASSWORD/DB_NAME. Detect drift instead of silently
  # computing a DATABASE_URL that doesn't match reality.
  existing_port="$(docker port "$CONTAINER_NAME" 5432/tcp 2>/dev/null | sed -n 's/.*:\([0-9]\+\)$/\1/p' | head -n1 || true)"
  existing_db="$(docker inspect "$CONTAINER_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^POSTGRES_DB=//p')"
  existing_user="$(docker inspect "$CONTAINER_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^POSTGRES_USER=//p')"

  drift=""
  [ -n "$existing_port" ] && [ "$existing_port" != "$DB_PORT" ] && drift="port ($existing_port != $DB_PORT)"
  [ -n "$existing_db" ] && [ "$existing_db" != "$DB_NAME" ] && drift="${drift:+$drift, }db ($existing_db != $DB_NAME)"
  [ -n "$existing_user" ] && [ "$existing_user" != "$DB_USER" ] && drift="${drift:+$drift, }user ($existing_user != $DB_USER)"

  if [ -n "$drift" ]; then
    if [ "$FORCE_RECREATE" = "1" ]; then
      echo "== config drift detected ($drift) — FORCE_RECREATE=1, removing ${CONTAINER_NAME} (data lost) =="
      docker rm -f "$CONTAINER_NAME" >/dev/null
    else
      echo "error: ${CONTAINER_NAME} already exists with different config: $drift" >&2
      echo "  Re-run with FORCE_RECREATE=1 to destroy and recreate it (this deletes its data)," >&2
      echo "  or unset DB_PORT/DB_USER/DB_PASSWORD/DB_NAME to match the existing container." >&2
      exit 1
    fi
  fi
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
  # umask 077 + explicit chmod: .env holds a real (if local-only) credential,
  # keep it non-world-readable regardless of the caller's umask.
  ( umask 077 && echo "DATABASE_URL=${DATABASE_URL}" > "$REPO_ROOT/.env" )
  chmod 600 "$REPO_ROOT/.env"
  echo "== wrote .env with DATABASE_URL (gitignored, chmod 600) =="
else
  echo "== .env already exists, leaving it untouched (expected DB: $(redacted_url)) =="
fi

echo "== done =="
echo "DATABASE_URL: $(redacted_url) (see .env for the full value)"
echo "Run the API server with: pnpm --filter @workspace/api-server run dev"
