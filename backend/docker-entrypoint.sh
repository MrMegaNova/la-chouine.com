#!/bin/sh
set -e

echo "[entrypoint] Running database migrations…"
node src/db/migrate.js

echo "[entrypoint] Starting server…"
exec "$@"
