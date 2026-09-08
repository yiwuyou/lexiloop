"""Generate explicit spelling contrasts from real course words, never invented roots."""
import json
import re
from pathlib import Path
from difflib import SequenceMatcher

root = Path(__file__).resolve().parents[1]
path = root / 'data/learning-content.js'
data = json.loads(path.read_text('utf-8').split('module.exports')[1].lstrip(' =').rstrip(';\r\n'))
heads = {}
for item in data.values():
    heads.setdefault(item['spokenWord'], item)

def gloss(item):
    return re.split('[;；]', item['meaning'])[0].strip()

def diff_parts(first, second):
    prefix = 0
    while prefix < min(len(first), len(second)) and first[prefix] == second[prefix]:
        prefix += 1
    suffix = 0
    while suffix < min(len(first), len(second)) - prefix and first[-suffix-1] == second[-suffix-1]:
        suffix += 1
    return first[prefix:len(first)-suffix if suffix else len(first)], second[prefix:len(second)-suffix if suffix else len(second)]

def chinese_terms(value):
    """Return meaningful definition fragments for conservative semantic grouping."""
    ignored = {'一种', '事物', '东西', '人员', '有关', '进行', '表示', '具有', '使得', '方面', '行为'}
    terms = set()
    for segment in re.findall(r'[\u4e00-\u9fff]{2,}', value):
        if segment not in ignored:
            terms.add(segment[:6])
        for size in (4, 3, 2):
            for start in range(max(0, len(segment) - size + 1)):
                term = segment[start:start + size]
                if term not in ignored:
                    terms.add(term)
    return terms

semantic_index = {}
for peer_head, peer_item in heads.items():
    for term in chinese_terms(peer_item['meaning']):
        semantic_index.setdefault(term, []).append(peer_head)

def semantic_hint(head, item):
    matches = []
    for term in chinese_terms(item['meaning']):
        for other in semantic_index.get(term, []):
            if other != head:
                matches.append((len(term), -len(other), term, other))
    if not matches:
        return ''
    _, _, term, other = max(matches)
    return f'语义归组：{head} 和 {other} 都涉及“{term}”；先用这个共同概念定位，再辨清各自的完整释义。'

PREFIXES = {
    'un': '否定或相反', 're': '再次或返回', 'over': '过度或在上方', 'under': '不足或在下方',
    'fore': '在前或预先', 'pre': '在前或预先', 'post': '在后', 'anti': '反对或抵抗',
    'inter': '在……之间', 'sub': '在下或次一级', 'super': '在上或超出', 'mis': '错误地',
    'out': '超过或向外', 'up': '向上', 'down': '向下', 'with': '向后或离开',
}

def structure_hint(head):
    if ' ' in head or '/' in head:
        return f'把 {head} 作为一个完整词组或同词变体来记，不要拆成互不相关的单词。'
    for prefix, meaning in sorted(PREFIXES.items(), key=lambda row: -len(row[0])):
        base = head[len(prefix):]
        if head.startswith(prefix) and base in heads:
            return f'构词联系：{prefix}- 表示“{meaning}”，联系 {base} 一起理解 {head}。'
    return ''

counts = {'curated':0, 'contrast':0, 'family':0, 'spelling':0, 'structure':0, 'semantic':0, 'anchor':0}
pending = []
for item in data.values():
    head = item['spokenWord']
    if item['cue']:
        item['associationHint'] = item['cue']
        kind = 'curated'
    elif item['contrast']:
        item['associationHint'] = item['contrast'].split('\n')[0]
        kind = 'contrast'
    elif item['family']:
        item['associationHint'] = head + '（' + gloss(item) + '） ↔ ' + item['family']
        kind = 'family'
    else:
        candidates = []
        for other, peer in heads.items():
            if head == other or abs(len(head)-len(other)) > 2 or len(head) < 4 or len(other) < 4:
                continue
            if not (head[:2] == other[:2] or head[-3:] == other[-3:]):
                continue
            if gloss(item) == gloss(peer):
                continue
            score = SequenceMatcher(None, head, other, autojunk=False).ratio()
            # Only surface very close spellings. Loose matches (for example,
            # words sharing a common suffix) distract more than they help.
            if score >= .80:
                candidates.append((score, -len(other), other))
        if candidates:
            other = max(candidates)[2]
            first_part, second_part = diff_parts(head, other)
            difference = ('；区分 ' + first_part + ' / ' + second_part) if first_part and second_part else ''
            item['associationHint'] = head + '（' + gloss(item) + '）与 ' + other + '（' + gloss(heads[other]) + '）对照记' + difference + '。'
            item['associationPeer'] = other
            kind = 'spelling'
        else:
            hint = structure_hint(head)
            if hint:
                item['associationHint'] = hint
                kind = 'structure'
            else:
                hint = semantic_hint(head, item)
                if hint:
                    item['associationHint'] = hint
                    kind = 'semantic'
                else:
                    item['associationHint'] = f'词义锚点：看到 {head}，先立即说出“{gloss(item)}”，再展开机构释义中的其他义项。'
                    kind = 'anchor'
                    pending.append((head, item['meaning']))
    item['associationKind'] = kind
    counts[kind] += 1
    # These values are reproducible audit data, not runtime content. Keep the
    # main mini-program package small by deriving curated/family/contrast text
    # from the fields already present and dropping build-only fields.
    if kind in ('curated', 'contrast', 'family', 'semantic', 'anchor'):
        item.pop('associationHint', None)
    item.pop('associationPeer', None)
    item.pop('associationKind', None)
    item.pop('memoryPhrase', None)
    item.pop('cueLabel', None)
path.write_text('// Generated learning content and explicit word associations\nmodule.exports = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
report = root / 'scripts/work/association-audit.json'
report.write_text(json.dumps({'counts':counts, 'pending':pending}, ensure_ascii=False, indent=2), 'utf-8')
print(json.dumps({'counts':counts, 'pending':pending}, ensure_ascii=False))
