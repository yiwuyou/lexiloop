"""Build and grade full-word-list mnemonic candidates without publishing them.

This is intentionally a staging step.  A candidate reaches ``direct`` only
when visible letters/morphemes are explicitly connected to a Chinese meaning.
Phrase-, example- and scene-only fallbacks are rejected instead of silently
shipping low-value content.
"""
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_js(path):
    text = path.read_text('utf-8')
    return json.loads(text[text.index('=') + 1:text.rindex(';')])


def sentences(value):
    return [part.strip() for part in re.split(r'(?<=[。！？；])\s*', value or '') if part.strip()]


def compact(value, limit=120):
    value = re.sub(r'\s+', ' ', value or '').strip()
    value = re.sub(r'^(?:可以|你可以|我们可以|记忆方法[:：]?|记忆辅助[:：]?)\s*', '', value)
    chosen = ''
    for sentence in sentences(value):
        if len(chosen) + len(sentence) > limit:
            break
        chosen += sentence
        if len(chosen) >= 42:
            break
    if not chosen:
        chosen = value[:limit].rstrip('，,；; ')
    return chosen


def component_pairs(value, head):
    """Extract only letter pieces that are visibly present in the headword."""
    found = []
    patterns = [
        r'["“\']?([A-Za-z]{1,12})-?["”\']?\s*[（(]\s*([^）)]{1,24})[）)]',
        r'["“\']?([A-Za-z]{1,12})-?["”\']?\s*(?:表示|意为|意思是|意味着|表达)\s*["“\']?([^，。；;"”\']{1,24})',
        r'(?:词根|前缀|后缀)(?:是|为|来自)?\s*["“\']?-?([A-Za-z]{1,12})-?["”\']?[^。；]{0,24}?(?:表示|意为|意思是|意味着)\s*["“\']?([^，。；;"”\']{1,24})',
    ]
    lower = head.lower().replace('-', '')
    for pattern in patterns:
        for match in re.finditer(pattern, value or '', re.I):
            form = match.group(1).lower()
            meaning = re.sub(r'^[“"\']|[”"\']$', '', match.group(2)).strip()
            if form not in lower or not meaning or len(meaning) > 24:
                continue
            if any(form == old[0] for old in found):
                continue
            found.append((form, meaning))
    return found[:3]


content = load_js(ROOT / 'data' / 'learning-content.js')
guides = json.loads((ROOT / 'data' / 'memory-guides.json').read_text('utf-8'))
engra = json.loads((ROOT / 'data' / 'engra-roots.json').read_text('utf-8'))['words']
wordbook = json.loads((ROOT / 'data' / 'gpt-wordbook-source.json').read_text('utf-8'))['words']

routes = {}
counts = Counter()
for item in content.values():
    head = item['spokenWord'].lower()
    guide = guides.get(head, {})
    if guide.get('breakdown') and guide.get('breakdownNote'):
        routes[head] = {
            'grade': 'reviewed',
            'strategy': guide.get('associationLabel', '构词钩子'),
            'breakdown': guide['breakdown'],
            'bridge': guide['breakdownNote'],
        }
        counts['reviewed'] += 1
        continue

    if item.get('breakdown') and item.get('breakdownNote'):
        routes[head] = {
            'grade': 'review',
            'strategy': '待审构词钩子',
            'breakdown': item['breakdown'],
            'bridge': item['breakdownNote'],
            'source': 'existing-construction',
        }
        counts['review'] += 1
        continue

    engra_record = next((record for record in engra.get(head, [])
                         if record.get('mnemonic') and record.get('rootMeaning')), None)
    if engra_record:
        source = re.sub(r'^[a-z]+\.\s*', '', engra_record['mnemonic'], flags=re.I)
        source = source.replace('【', '').replace('】', '').strip('；;，, ')
        pairs = component_pairs(source + '；' + engra_record['rootMeaning'], head)
        root = engra_record['root'].lower()
        if not pairs and root in head:
            root_cn = re.sub(r'^[A-Za-z ,，]+', '', engra_record['rootMeaning']).strip()
            if root_cn:
                pairs = [(root, root_cn)]
        routes[head] = {
            'grade': 'direct' if pairs else 'review',
            'strategy': '构词钩子',
            'breakdown': '·'.join(form for form, _ in pairs) or head,
            'bridge': compact(source, 110),
            'source': 'engra',
        }
        counts[routes[head]['grade']] += 1
        continue

    source = wordbook.get(head, {})
    analysis = source.get('rootAnalysis', '') + ' ' + source.get('affixAnalysis', '')
    pairs = component_pairs(analysis, head)
    if pairs:
        display = ' + '.join(f'{form}（{meaning}）' for form, meaning in pairs)
        routes[head] = {
            'grade': 'direct',
            'strategy': '构词钩子',
            'breakdown': '·'.join(form for form, _ in pairs),
            'bridge': f'{display} → {item["meaning"]}',
            'source': 'gpt-wordbook-analysis',
        }
        counts['direct'] += 1
        continue

    aid = compact(source.get('memoryAid', ''), 120)
    has_form_move = bool(re.search(r'拆|分解|拆分|分为|看作|想成|谐音|发音|字母|词根|词缀|形状', aid))
    if aid and has_form_move:
        routes[head] = {
            'grade': 'review',
            'strategy': '待审字形/声音钩子',
            'breakdown': head,
            'bridge': aid,
            'source': 'gpt-wordbook-memory-aid',
        }
        counts['review'] += 1
    else:
        routes[head] = {
            'grade': 'missing',
            'strategy': '',
            'breakdown': '',
            'bridge': '',
            'source': '',
        }
        counts['missing'] += 1

output = ROOT / 'scripts' / 'work' / 'memory-route-candidates.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'counts': counts, 'routes': routes}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
print(json.dumps({'counts': counts, 'total': len(routes)}, ensure_ascii=False))
