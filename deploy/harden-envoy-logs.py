#!/usr/bin/env python3
"""Run on app102; strip credentials in query/referrer headers from gateway access logs."""
import os
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / 'supabase/volumes/api/envoy'
for name in ['lds.template.yaml']:
    path = root / name
    source = path.read_text()
    lines = source.splitlines(keepends=True)
    changed = False
    for index, line in enumerate(lines):
        if 'inline_string:' in line and index > 0 and lines[index - 1].strip() in ['log_format:', 'text_format_source:'] and 'REQ(:METHOD)' in line:
            lines[index] = line[:len(line) - len(line.lstrip())] + 'inline_string: "%START_TIME% %REQ(:METHOD)% %PATH(NQ:PATH)% %RESPONSE_CODE% %BYTES_SENT%\\n"\n'
            changed = True
    assert changed, 'Expected gateway access-log format missing'
    backup = root / (name + '.before-textus-m6')
    if not backup.exists():
        shutil.copy2(path, backup)
        os.chmod(backup, 0o600)
    path.write_text(''.join(lines))
print('Gateway access logs omit query strings and request headers')
