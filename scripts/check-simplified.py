"""Check shipped Chinese learning text without altering source institution records."""
import json
import sys
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts/work/tools'))
from opencc import OpenCC
convert = OpenCC('t2s').convert
errors = []
for filename in ['learning-content.js', 'enrichment.js', 'context-questions.js']:
    result = subprocess.run(['node', '-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])))',
                             str(root / 'data' / filename)], capture_output=True, check=True, encoding='utf-8')
    data = json.loads(result.stdout)
    def check(value, location):
        if isinstance(value, dict):
            for key, item in value.items():
                if key != 'exampleCredit':
                    check(item, location + '.' + key)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                check(item, location + '.' + str(index))
        elif isinstance(value, str) and convert(value) != value:
            errors.append((location, value, convert(value)))
    check(data, filename)
print(json.dumps({'traditionalTextCount': len(errors), 'examples': errors[:10]}, ensure_ascii=False))
if errors:
    raise SystemExit(1)
