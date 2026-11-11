#!/usr/bin/env bash
# Verifica un respaldo sin tocar la base original: comprueba la suma SHA-256, lo restaura en una
# base temporal, compara el conteo de filas con el manifiesto y elimina la base temporal.
# Uso: scripts/db/verify-backup.sh [archivo.dump]   (sin argumento usa el respaldo más reciente)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

load_database_url
source_url="$(libpq_url "$DATABASE_URL")"
dump="${1:-$(ls -1t "$backup_dir"/*.dump 2>/dev/null | head -n 1)}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "Error: no hay respaldos en $backup_dir" >&2
  exit 1
fi
manifest="${dump%.dump}.counts"

echo "1/4 Suma SHA-256 de $(basename "$dump")"
(cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$dump").sha256")
echo "    correcta"

verify_db="simona_bn_verify_$(date +%Y%m%d%H%M%S)"
verify_url="$(url_with_database "$source_url" "$verify_db")"
cleanup() { dropdb --if-exists --maintenance-db="$source_url" "$verify_db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "2/4 Restaurando en la base temporal $verify_db"
createdb --maintenance-db="$source_url" "$verify_db"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$verify_url" "$dump"

echo "3/4 Comparando filas por tabla con el manifiesto"
if diff <(table_counts "$verify_url") "$manifest" >/dev/null; then
  echo "    $(wc -l <"$manifest") tablas y $(awk -F'|' '{ total += $2 } END { print total }' "$manifest") filas coinciden"
else
  echo "Error: el conteo restaurado no coincide con el manifiesto:" >&2
  diff <(table_counts "$verify_url") "$manifest" >&2 || true
  exit 1
fi

echo "4/4 Última migración restaurada: $(psql "$verify_url" -X -A -t -c \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1")"
echo "Respaldo verificado. La base temporal se elimina al terminar."
