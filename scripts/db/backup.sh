#!/usr/bin/env bash
# Respaldo de la base de SIMONA-BN: volcado pg_dump (formato custom), suma SHA-256
# y manifiesto con el conteo de filas por tabla para verificar la restauración.
# Uso: scripts/db/backup.sh            (variables: DATABASE_URL, BACKUP_DIR, BACKUP_RETENTION)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

load_database_url
source_url="$(libpq_url "$DATABASE_URL")"
retention="${BACKUP_RETENTION:-14}"
timestamp="$(date +%Y%m%d_%H%M%S)"
database_name="$(sed -E 's#^postgres(ql)?://[^/]*/([^?]*).*#\2#' <<<"$source_url")"
base="$backup_dir/${database_name}_${timestamp}"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

pg_dump --format=custom --no-owner --no-privileges --file="$base.dump" "$source_url"
table_counts "$source_url" >"$base.counts"
(cd "$backup_dir" && sha256sum "$(basename "$base.dump")" >"$(basename "$base.dump").sha256")
chmod 600 "$base.dump" "$base.counts" "$base.dump.sha256"

# Retención: conserva los últimos N respaldos de esta base.
mapfile -t old < <(ls -1t "$backup_dir/${database_name}"_*.dump 2>/dev/null | tail -n +"$((retention + 1))")
for file in "${old[@]}"; do
  rm -f "$file" "${file%.dump}.counts" "$file.sha256"
done

echo "Respaldo creado: $base.dump ($(du -h "$base.dump" | cut -f1))"
echo "Tablas: $(wc -l <"$base.counts") · filas: $(awk -F'|' '{ total += $2 } END { print total }' "$base.counts")"
echo "Retención: últimos $retention respaldos en $backup_dir"
