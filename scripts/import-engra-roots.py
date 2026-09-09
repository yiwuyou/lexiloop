"""Import only this app's word/root records from the MIT-licensed engra dataset.

The upstream repository cannot be checked out normally on Windows because it
contains a file named ``con.yml``. Read blobs through ``git show`` instead.
Usage: python scripts/import-engra-roots.py <path-to-engra-repository>
"""
import csv
import io
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if not UPSTREAM or not (UPSTREAM / '.git').exists():
    raise SystemExit('Pass the local engra git repository path.')


def git(*args):
    command = ['git', '-c', f'safe.directory={UPSTREAM.as_posix()}', '-C', str(UPSTREAM), *args]
    return subprocess.check_output(command).decode('utf-8-sig')


def git_blobs(paths):
    command = [
        'git', '-c', f'safe.directory={UPSTREAM.as_posix()}', '-C', str(UPSTREAM),
        'cat-file', '--batch',
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    blobs = {}
    for path in paths:
        process.stdin.write(f'HEAD:{path}\n'.encode())
        process.stdin.flush()
        header = process.stdout.readline().decode().strip().split()
        if len(header) != 3:
            raise RuntimeError(f'Cannot read {path}: {header}')
        size = int(header[2])
        blobs[path] = process.stdout.read(size).decode('utf-8-sig')
        process.stdout.read(1)
    process.stdin.close()
    if process.wait() != 0:
        raise subprocess.CalledProcessError(process.returncode, command)
    return blobs


def load_js(path):
    text = path.read_text('utf-8')
    return json.loads(text[text.index('=') + 1:text.rindex(';')])


def scalar(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def parse_root_yaml(text):
    """Parse the small scalar subset used by engra root records."""
    top = {}
    nodes = []
    stack = []
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        indent = len(raw) - len(raw.lstrip(' '))
        match = re.match(r'\s*- name:\s*(.+)$', raw)
        if match:
            while stack and stack[-1][0] >= indent:
                stack.pop()
            node = {'name': scalar(match.group(1)), '_indent': indent}
            nodes.append(node)
            stack.append((indent, node))
            continue
        match = re.match(r'\s*([A-Za-z_]+):\s*(.*)$', raw)
        if not match:
            continue
        key, value = match.group(1), scalar(match.group(2))
        if stack and indent > stack[-1][0]:
            stack[-1][1][key] = value
        elif indent == 0:
            top[key] = value
    return top, nodes


content = load_js(ROOT / 'data' / 'learning-content.js')
heads = {item['spokenWord'].lower() for item in content.values()}

# Read the upstream tree in one persistent ``cat-file`` process. The repository
# contains ``con.yml``, which Windows refuses to check out or archive by name.
paths = git('ls-tree', '-r', '--name-only', 'HEAD', 'dict/roots').splitlines()
upstream_files = git_blobs(['dict/words.csv', *paths])

word_rows = {}
for row in csv.DictReader(io.StringIO(upstream_files['dict/words.csv'])):
    lower = row['name'].lower()
    if lower in heads and lower not in word_rows:
        word_rows[lower] = row

path_by_stem = {Path(path).stem.lower(): path for path in paths if path.endswith('.yml')}
root_cache = {}


def root_record(root_name):
    key = root_name.strip().lower()
    if not key:
        return None
    if key in root_cache:
        return root_cache[key]
    path = path_by_stem.get(key)
    if not path:
        root_cache[key] = None
        return None
    top, nodes = parse_root_yaml(upstream_files[path])
    root_cache[key] = {'name': top.get('name', root_name), 'meaning': top.get('meaning', ''), 'nodes': nodes}
    return root_cache[key]


result = {}
for head in sorted(heads):
    row = word_rows.get(head)
    if not row or not row.get('roots'):
        continue
    roots = [part.strip() for part in re.split(r'[/,]', row['roots']) if part.strip()]
    records = []
    for root_name in roots:
        record = root_record(root_name)
        if not record:
            continue
        node = next((item for item in record['nodes'] if item.get('name', '').lower() == head), {})
        records.append({
            'root': record['name'],
            'rootMeaning': record['meaning'],
            'mnemonic': node.get('mnemonic', ''),
            'wordMeaning': node.get('meaning', ''),
        })
    if records:
        result[head] = records

output = ROOT / 'data' / 'engra-roots.json'
# Keep the compact root glossary as well.  It lets the downstream builder use
# the same reviewed Chinese meaning when another licensed segmentation source
# identifies an equivalent spelling form.
root_glossary = {}
for stem in sorted(path_by_stem):
    record = root_record(stem)
    if record and record.get('meaning'):
        root_glossary[stem] = record['meaning']
output.write_text(json.dumps({
    '_source': 'eslsoft/engra (MIT), imported records only',
    '_license': 'See THIRD_PARTY_NOTICES.md',
    'roots': root_glossary,
    'words': result,
}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(json.dumps({'heads': len(heads), 'mapped': len(result), 'rootFiles': len(root_cache),
                  'rootGlosses': len(root_glossary)}, ensure_ascii=False))
