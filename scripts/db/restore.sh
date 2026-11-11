#!/usr/bin/env bash
# Restaura un respaldo en una base de destino EXISTENTE, reemplazando su contenido.
# Uso: scripts/db/restore.sh archivo.dump postgresql://usuario@host/base_destino
# Pide confirmación escribiendo el nombre de la base; usa --yes solo en procedimientos automatizados.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

dump="${1:-}"
target="${2:-}"
if [[ -z "$dump" || -z "$target" || ! -f "$dump" ]]; then
  echo "Uso: $0 archivo.dump postgresql://usuario@host/base_destino [--yes]" >&2
  exit 1
fi
target_url="$(libpq_url "$target")"
target_db="$(sed -E 's#^postgres(ql)?://[^/]*/([^?]*).*#\2#' <<<"$target_url")"

(cd "$(dirname "$dump")" && sha256sum --check --quiet "$(basename "$dump").sha256")
echo "Suma SHA-256 correcta: $(basename "$dump")"

if [[ "${3:-}" != "--yes" ]]; then
  echo "Se reemplazará TODO el contenido de la base '$target_db'."
  read -r -p "Escribe el nombre de la base para confirmar: " answer
  if [[ "$answer" != "$target_db" ]]; then
    echo "Cancelado." >&2
    exit 1
  fi
fi

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$target_url" "$dump"
echo "Restauración completada en '$target_db'. Filas por tabla:"
table_counts "$target_url" | awk -F'|' '{ printf "  %-28s %s\n", $1, $2 }'
