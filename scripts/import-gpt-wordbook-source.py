"""Import compact candidate analyses from the MIT-licensed GPT Wordbook.

The imported text is research input, not user-facing copy.  The memory-aid
builder may use a short, validated form-to-meaning bridge from it, but must not
fall back to examples, phrases or free-standing scenes.

Usage: python scripts/import-gpt-wordbook-source.py <path-to-repository>
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if not UPSTREAM or not (UPSTREAM / '.git').exists():
    raise SystemExit('Pass the local GPT Wordbook git repository path.')


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


def section(text, title):
    match = re.search(rf'^### {re.escape(title)}\s*$\n(.*?)(?=^### |\Z)', text, re.M | re.S)
    if not match:
        return ''
    value = match.group(1)
    value = re.sub(r'<[^>]+>', ' ', value)
    value = re.sub(r'^\s*[-*]\s*', '', value, flags=re.M)
    value = re.sub(r'^\s*\d+\.\s*', '', value, flags=re.M)
    value = value.replace('"', '').replace('“', '').replace('”', '')
    return re.sub(r'\s+', ' ', value).strip()


content = load_js(ROOT / 'data' / 'learning-content.js')
heads = {item['spokenWord'].lower() for item in content.values()}
paths = git('ls-tree', '-r', '--name-only', 'HEAD', 'src/content/docs/words').splitlines()
selected = {}
for path in paths:
    if not path.endswith('.mdx'):
        continue
    head = Path(path).stem.lower()
    if head in heads and head not in selected:
        selected[head] = path

blobs = git_blobs(selected.values())
result = {}
for head, path in sorted(selected.items()):
    text = blobs[path]
    result[head] = {
        'rootAnalysis': section(text, '词根分析'),
        'affixAnalysis': section(text, '词缀分析'),
        'memoryAid': section(text, '记忆辅助'),
    }

output = ROOT / 'data' / 'gpt-wordbook-source.json'
output.write_text(json.dumps({
    '_source': 'nicejade/gpt-wordbook (MIT), compact research fields only',
    '_license': 'See THIRD_PARTY_NOTICES.md',
    'words': result,
}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(json.dumps({
    'heads': len(heads),
    'mapped': len(result),
    'rootAnalysis': sum(bool(item['rootAnalysis']) for item in result.values()),
    'memoryAid': sum(bool(item['memoryAid']) for item in result.values()),
}, ensure_ascii=False))
