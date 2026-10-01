#!/usr/bin/env python3
"""Verify a private filesystem snapshot against an isolated Supabase database."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

container, directory = sys.argv[1:]
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', container):
    sys.exit('Invalid container name')
query = "SELECT json_build_object('bucket',a.bucket,'path',a.storage_path,'version',o.version,'size',a.file_size,'checksum',a.checksum_sha256) FROM public.assets a LEFT JOIN storage.objects o ON o.bucket_id=a.bucket AND o.name=a.storage_path"
rows = subprocess.check_output(['docker', 'exec', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atc', query], text=True).splitlines()
for line in rows:
    asset = json.loads(line)
    assert asset['version'], 'Asset has no registered Storage object version'
    path = pathlib.Path(directory) / 'stub' / 'stub' / asset['bucket'] / asset['path'] / asset['version']
    assert path.resolve().is_relative_to(pathlib.Path(directory).resolve()), 'Object path escapes snapshot'
    assert path.is_file(), 'Referenced object bytes missing'
    assert path.stat().st_size == asset['size'], 'Object size differs from immutable asset'
    with path.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == asset['checksum'], 'Object checksum mismatch'
print(f"Verified {len(rows)} restored assets: registered versions, sizes and SHA-256 checksums")
