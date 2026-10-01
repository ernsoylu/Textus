#!/usr/bin/env bash
# Run on app102. The private snapshot contains credentials and library contents.
set -euo pipefail
umask 077
root="${TEXTUS_SUPABASE_DIR:-$HOME/supabase}"
snapshot="${TEXTUS_BACKUP_DIR:-$HOME/.local/share/textus-backups}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$snapshot"
chmod 700 "$snapshot"
docker image inspect alpine:3.23 >/dev/null 2>&1 || docker pull alpine:3.23 >/dev/null
paused=()
resume() { for container in "${paused[@]}"; do docker unpause "$container" >/dev/null || true; done; }
trap resume EXIT INT TERM
# Freeze all API writers while the committed database and file bytes are copied.
for container in textus-web supabase-rest supabase-storage supabase-edge-functions supabase-auth realtime-dev.supabase-realtime; do
  docker pause "$container" >/dev/null
  paused+=("$container")
done
docker exec supabase-db pg_dumpall -U postgres --roles-only --no-role-passwords > "$snapshot/roles.sql"
docker exec supabase-db pg_dump -U postgres --format=custom --no-owner postgres > "$snapshot/database.dump"
docker run --rm --network none --volumes-from supabase-storage --entrypoint tar alpine:3.23 -C /var/lib/storage -cf - . > "$snapshot/storage.tar"
# database.dump cannot be replayed into a fresh Supabase image (auth/storage schemas collide).
# The restore source is this frozen data directory plus the pgsodium root key Vault needs.
docker pause supabase-db >/dev/null
paused=(supabase-db "${paused[@]}")
docker run --rm --network none --volumes-from supabase-db --entrypoint tar alpine:3.23 -cf - -C / var/lib/postgresql/data etc/postgresql-custom > "$snapshot/postgres.tar"
(cd "$root" && tar -czf "$snapshot/configuration.tar.gz" .env docker-compose*.yml volumes/functions volumes/api)
# Capture the exact currently deployed image for rollback without mutable latest tags.
docker inspect textus-web --format '{{.Image}}' > "$snapshot/frontend-image.txt"
# A tag keeps the rollback image from being pruned once a rebuild moves latest.
docker tag "$(cat "$snapshot/frontend-image.txt")" "textus-web:backup-$(basename "$snapshot" | tr 'A-Z' 'a-z')"
(cd "$snapshot" && sha256sum roles.sql database.dump postgres.tar storage.tar configuration.tar.gz frontend-image.txt > SHA256SUMS)
resume
paused=()
printf 'Private backup complete: %s\n' "$snapshot"
