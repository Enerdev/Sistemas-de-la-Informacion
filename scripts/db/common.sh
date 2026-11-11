# Funciones compartidas por los scripts de respaldo. Se carga con `source`.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup_dir="${BACKUP_DIR:-$repo_root/backups}"

# DATABASE_URL del entorno o, si no existe, de apps/api/.env.
load_database_url() {
  if [[ -z "${DATABASE_URL:-}" && -f "$repo_root/apps/api/.env" ]]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "$repo_root/apps/api/.env" | head -n 1 | cut -d= -f2-)"
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "Error: define DATABASE_URL o configúrala en apps/api/.env" >&2
    exit 1
  fi
}

# Prisma agrega ?schema=public, que las herramientas de PostgreSQL no aceptan.
libpq_url() {
  local url="$1"
  url="$(sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//' <<<"$url")"
  printf '%s' "$url"
}

# Reemplaza el nombre de la base en una URL postgresql://.../base?params
url_with_database() {
  local url="$1" database="$2"
  sed -E "s#^(postgres(ql)?://[^/]*/)[^?]*#\\1${database}#" <<<"$url"
}

# Conteo de filas por tabla del esquema public, una línea "tabla|filas" ordenada.
table_counts() {
  psql "$1" -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
SELECT table_name || '|' || (xpath('/row/c/text()',
  query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
SQL
}
