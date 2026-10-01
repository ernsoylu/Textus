#!/usr/bin/env bash
# Run on app102: prove library files and private tables are unreachable through the public API without a session.
set -euo pipefail
api="${TEXTUS_API_URL:-https://base.textus.bff.bz}"
key="$(grep -E '^ANON_KEY=' "${TEXTUS_SUPABASE_DIR:-$HOME/supabase}/.env" | cut -d= -f2-)"
path="$(docker exec supabase-db psql -U supabase_admin -d postgres -Atc "SELECT bucket||'/'||storage_path FROM public.assets LIMIT 1")"
[ -n "$path" ] || { echo 'No asset to probe' >&2; exit 1; }
[ "$(docker exec supabase-db psql -U supabase_admin -d postgres -Atc "SELECT count(*) FROM storage.buckets WHERE public")" = 0 ] || { echo 'Public bucket exists' >&2; exit 1; }
for url in "storage/v1/object/public/$path" "storage/v1/object/$path" "storage/v1/object/authenticated/$path"; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' -H "apikey: $key" -H "Authorization: Bearer $key" "$api/$url")"
  case "$status" in 2*|3*) echo "Anonymous file read succeeded: HTTP $status" >&2; exit 1;; esac
done
for table in assets works agent_tokens agent_actions; do
  body="$(curl -sS -H "apikey: $key" "$api/rest/v1/$table?select=id&limit=1")"
  [ "$body" = '[]' ] || [[ "$body" == *'"code"'* ]] || { echo "Anonymous rows returned from $table" >&2; exit 1; }
done
echo 'Anonymous object, public-object and table reads are denied; all buckets are private'
