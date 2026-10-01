import pathlib
import subprocess
import tempfile
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    original = 'log_format:\n  text_format_source:\n    inline_string: "%REQ(:METHOD)% %REQ(:PATH)%"\nusers:\n  inline_string: "admin:{SHA}credential-fixture"\n'
    config = root / 'lds.template.yaml'
    config.write_text(original)
    subprocess.run(['python3', str(pathlib.Path(__file__).with_name('harden-envoy-logs.py')), directory], check=True)
    result = config.read_text()
    assert 'admin:{SHA}credential-fixture' in result
    assert '%PATH(NQ:PATH)%' in result
    assert '%REQ(:PATH)%' not in result
    assert (root / 'lds.template.yaml.before-textus-m6').read_text() == original
print('Access-log-only rewrite and rollback copy passed')
