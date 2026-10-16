#!/usr/bin/env bash
# Apply table definitions, then the migrations that turn tenant isolation on.
# Usage: DATABASE_URL=postgresql://... ./scripts/apply.sh

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"

apply_dir() {
  local dir="$1"
  local file
  for file in "$dir"/*.sql; do
    echo "Applying ${file#"$root"/}"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
  done
}

apply_dir "$root/src"
apply_dir "$root/migrations"
