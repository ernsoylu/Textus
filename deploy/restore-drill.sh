#!/usr/bin/env bash
# Run on app102: restore a deploy/backup.sh snapshot into a network-isolated database and verify it.
# Usage: bash deploy/restore-drill.sh <snapshot-dir>. Leaves production untouched; removes the drill afterwards.
set -euo pipefail
umask 077
snapshot="$(cd "$1" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"
image="$(docker inspect supabase-db --format '{{.Config.Image}}')"
name=textus-restore-drill
files="$(mktemp -d)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm -f "$name-data" "$name-config" >/dev/null 2>&1 || true; rm -rf "$files"; }
trap cleanup EXIT INT TERM
(cd "$snapshot" && sha256sum --quiet -c SHA256SUMS)
docker run --rm --network none -v "$name-data:/var/lib/postgresql/data" -v "$name-config:/etc/postgresql-custom" \
  -i --entrypoint tar alpine:3.23 -xf - -C / < "$snapshot/postgres.tar"
# No network and no cron: restored jobs, webhooks and pg_net requests cannot reach anything.
docker run -d --name "$name" --network none -v "$name-data:/var/lib/postgresql/data" -v "$name-config:/etc/postgresql-custom" \
  "$image" postgres -c config_file=/etc/postgresql/postgresql.conf -c cron.launch_active_jobs=off >/dev/null
for _ in $(seq 60); do docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
sql() { docker exec "$1" psql -U supabase_admin -d postgres -Atc "$2"; }
# Row counts are informational; permissions must match production exactly.
counts="SELECT (SELECT count(*) FROM auth.users)||' users, '||(SELECT count(*) FROM public.works)||' works, '||(SELECT count(*) FROM public.assets)||' assets, '||(SELECT count(*) FROM storage.objects)||' objects'"
permissions="SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT c.oid::regclass::text||c.relrowsecurity||c.relforcerowsecurity||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'storage'::regnamespace) AND c.relkind IN ('r','p','v','m')
  UNION ALL SELECT schemaname||tablename||policyname||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,'') FROM pg_policies
  UNION ALL SELECT p.oid::regprocedure::text||coalesce(p.proacl::text,'')||p.prosecdef FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'private'::regnamespace)
  UNION ALL SELECT (SELECT string_agg(id||public::text, ',' ORDER BY id) FROM storage.buckets)) s(x)"
echo "Restored: $(sql "$name" "$counts")"
[ "$(sql "$name" "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT relrowsecurity")" = 0 ] || { echo 'Restored table without RLS' >&2; exit 1; }
[ "$(sql "$name" "SELECT count(*) FROM storage.buckets WHERE public")" = 0 ] || { echo 'Restored public bucket' >&2; exit 1; }
[ "$(sql "$name" "$permissions")" = "$(sql supabase-db "$permissions")" ] || { echo 'Restored RLS/grants differ from production' >&2; exit 1; }
echo 'RLS, policies, grants, function privileges and private buckets match production'
sql "$name" "DELETE FROM public.agent_tokens" >/dev/null
echo "Agent tokens after deletion: $(sql "$name" "SELECT count(*) FROM public.agent_tokens")"
tar -xf "$snapshot/storage.tar" -C "$files"
python3 "$here/verify-restored-assets.py" "$name" "$files"
