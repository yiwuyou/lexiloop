"""Build one useful memory route per word without pretending one rule fits all.

Priority:
1. reviewed, word-specific cue;
2. reviewed/transparent construction;
3. reviewed confusion contrast;
4. verified word family;
5. a short lexical chunk taken from the word's real example.

The fallback deliberately keeps the target word inside a short English chunk. It
does not invent roots, compare unrelated spellings, or repeat a Chinese semantic
group as though that were a mnemonic.
"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'data/learning-content.js'
data = json.loads(path.read_text('utf-8').split('module.exports')[1].lstrip(' =').rstrip(';\r\n'))


def gloss(item):
    return re.split('[;；]', item['meaning'])[0].strip()


def words_in(value):
    return re.findall(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", value or '')


def lexical_chunk(item):
    """Extract a compact, POS-aware chunk around the actual target form."""
    tokens = words_in(item.get('example', ''))
    if not tokens:
        return item['spokenWord']

    forms = {item['spokenWord'].lower()}
    forms.update(form['word'].lower() for form in item.get('wordForms', []))
    index = next((i for i, token in enumerate(tokens) if token.lower() in forms), -1)
    if index < 0:
        return item['spokenWord']

    pos = item.get('partOfSpeech', '')
    if '形容词' in pos:
        if index + 1 < len(tokens):
            start, end = index, index + 2
        else:
            start, end = max(0, index - 1), index + 1
    elif '名词' in pos and '动词' not in pos:
        if index + 1 < len(tokens) and tokens[index + 1].lower() == 'of':
            start, end = index, min(len(tokens), index + 5)
        elif index >= 2 and tokens[index - 1].lower() in {'a', 'an', 'the', 'this', 'that', 'my', 'your', 'his', 'her', 'our', 'their'}:
            start, end = max(0, index - 2), index + 1
        else:
            start, end = max(0, index - 1), index + 1
    elif '动词' in pos:
        boundaries = {'and', 'but', 'while', 'when', 'during', 'after', 'before', 'because', 'who', 'which', 'that'}
        end = index + 1
        while end < len(tokens) and end < index + 4:
            if end > index + 1 and tokens[end].lower() in boundaries:
                break
            end += 1
        start = index
        if end == index + 1:
            start = max(0, index - 2)
    else:
        start, end = max(0, index - 1), min(len(tokens), index + 3)

    chunk = ' '.join(tokens[start:end])
    return chunk if len(chunk) <= 52 else ' '.join(tokens[index:min(len(tokens), index + 3)])


def chunk_label(item):
    pos = item.get('partOfSpeech', '')
    if '形容词' in pos:
        return '状态短语'
    if '名词' in pos and '动词' not in pos:
        return '名词短语'
    if '动词' in pos:
        return '动作短语'
    return '用法短语'


def informative_chunk(chunk, head):
    fillers = {'a', 'an', 'the', 'this', 'that', 'my', 'your', 'his', 'her', 'our', 'their'}
    content = [token.lower() for token in words_in(chunk)
               if token.lower() not in fillers and token.lower() != head.lower()]
    return bool(content)


def scene_hint(item):
    scene = re.split(r'[。！？!?]', item.get('translation', ''))[0].strip()
    if len(scene) > 38:
        scene = scene[:37].rstrip('，,；; ') + '…'
    return f'把这幕定格：{scene}；在画面出现时说 {item["spokenWord"]}。'


counts = {'curated': 0, 'construction': 0, 'contrast': 0, 'family': 0, 'chunk': 0, 'scene': 0}
missing = []
samples = {key: [] for key in counts}

for item in data.values():
    item.pop('associationHint', None)
    item.pop('associationPeer', None)
    item.pop('associationKind', None)

    if item.get('cue'):
        kind = 'curated'
        item['associationHint'] = item['cue']
        item['associationLabel'] = item.get('associationLabel') or '主钩子'
    elif item.get('breakdown') and item.get('breakdownNote'):
        kind = 'construction'
        item.pop('associationLabel', None)
    elif item.get('contrast'):
        kind = 'contrast'
        item.pop('associationLabel', None)
    elif item.get('family'):
        kind = 'family'
        item.pop('associationLabel', None)
    else:
        chunk = lexical_chunk(item)
        if chunk and informative_chunk(chunk, item['spokenWord']):
            kind = 'chunk'
            item['associationHint'] = f'“{chunk}”整块记：{gloss(item)}。'
            item['associationLabel'] = chunk_label(item)
        elif item.get('translation'):
            kind = 'scene'
            item['associationHint'] = scene_hint(item)
            item['associationLabel'] = '画面钩子'
        else:
            kind = 'scene'
            missing.append((item['spokenWord'], item['meaning']))

    counts[kind] += 1
    if len(samples[kind]) < 12:
        samples[kind].append({
            'word': item['spokenWord'],
            'breakdown': item.get('breakdown', ''),
            'hint': item.get('associationHint', ''),
            'contrast': item.get('contrast', ''),
            'family': item.get('family', ''),
        })

    item.pop('memoryPhrase', None)
    item.pop('cueLabel', None)

path.write_text('// Generated learning content with adaptive memory routes\nmodule.exports = '
                + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
report = root / 'scripts/work/association-audit.json'
report.write_text(json.dumps({'counts': counts, 'missing': missing, 'samples': samples},
                             ensure_ascii=False, indent=2), 'utf-8')
print(json.dumps({'counts': counts, 'missing': missing}, ensure_ascii=False))
if missing:
    raise SystemExit('Every word must have a memory route.')
