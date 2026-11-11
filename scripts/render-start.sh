#!/usr/bin/env bash
# Arranque en Render (o cualquier servidor): migraciones, datos base, demo si la base está vacía y API.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../apps/api"

npx prisma migrate deploy
# Canales base y, solo si aún no hay ningún ADMIN, el primer administrador (SEED_ADMIN_EMAIL/PASSWORD).
npx tsx prisma/seed.ts
if [[ "${DEMO_SEED_IF_EMPTY:-false}" == "true" ]]; then
  # Carga la demostración únicamente en el primer arranque (sin verificaciones previas).
  npx tsx prisma/seed-demo.ts --reset --allow-production --if-empty
fi
exec node dist/server.js
