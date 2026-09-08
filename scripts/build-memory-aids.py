"""Enrich every source record with dictionary-backed aids; never invent etymology.

Run after build-learning-content.py. Custom concept explanations and real word
families are reviewed separately in data/memory-guides.json and word-relations.json.
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'scripts' / 'work'
sys.path.insert(0, str(WORK / 'tools'))
from opencc import OpenCC
convert = OpenCC('t2s').convert

def load_js(path):
    return json.loads(path.read_text('utf-8').split('module.exports')[1].lstrip(' =').rstrip(';\r\n'))

content = load_js(ROOT / 'data/learning-content.js')
vocabulary = load_js(ROOT / 'data/vocabulary.js')
guides = json.loads((ROOT / 'data/memory-guides.json').read_text('utf-8'))
relations = json.loads((ROOT / 'data/word-relations.json').read_text('utf-8'))
heads = {item['spokenWord'] for item in content.values()}
needed = heads | {word for group in relations['families'] for word in group}
dictionary = {}
known_words = set()
with (WORK / 'ecdict.csv').open(encoding='utf-8', newline='') as stream:
    for entry in csv.DictReader(stream):
        known_words.add(entry['word'])
        if entry['word'] in needed:
            dictionary[entry['word']] = entry

POS = {'n':'n. 名词', 'v':'v. 动词', 'vt':'vt. 及物动词', 'vi':'vi. 不及物动词',
       'a':'adj. 形容词', 'adj':'adj. 形容词', 's':'adj. 形容词',
       'ad':'adv. 副词', 'adv':'adv. 副词', 'r':'adv. 副词',
       'prep':'prep. 介词', 'conj':'conj. 连词', 'pron':'pron. 代词',
       'num':'num. 数词', 'interj':'interj. 感叹词', 'aux':'aux. 助动词', 'det':'det. 限定词'}
EXPLICIT_POS = {'owing to':'介词短语', 'ought to':'情态动词短语', 'air conditioning':'n. 名词短语',
                'conservative':'adj. 形容词 / n. 名词', 'core':'n. 名词 / adj. 形容词 / v. 动词',
                'pole':'n. 名词 / v. 动词', 'polish':'v. 动词 / n. 名词',
                'affordable':'adj. 形容词', 'Internet':'n. 名词', 'grown-up':'n. 名词 / adj. 形容词',
                'so-called':'adj. 形容词', 'well-known':'adj. 形容词', 'proceedings':'n. 名词（复数）'}

def senses(entry):
    result = []
    for line in entry.get('translation', '').split('\\n'):
        match = re.match(r'^(n|vt|vi|v|a|adj|adv|ad|prep|conj|pron|num|interj|aux|det)\.\s*(.*)', line)
        if match:
            result.append((POS[match[1]], convert(match[2])))
    return result

def gloss(word):
    rows = senses(dictionary.get(word, {}))
    return re.split('[,，;；]', rows[0][1])[0].strip() if rows else ''

def family_for(head):
    peers = []
    for group in relations['families']:
        if head not in group:
            continue
        for member in group:
            meaning = gloss(member)
            if member != head and meaning and member not in [p[0] for p in peers]:
                peers.append((member, meaning))
    return ' · '.join(f'{word} {meaning}' for word, meaning in peers[:3])

def form_items(entry):
    exchanges = dict(pair.split(':', 1) for pair in entry.get('exchange', '').split('/') if ':' in pair)
    labels = {'p':'过去式', 'd':'过去分词', 'i':'现在分词', 'r':'比较级', 't':'最高级'}
    result = []
    for tag, label in labels.items():
        value = exchanges.get(tag)
        if value and not any(value == item['word'] for item in result):
            if tag == 'p' and value == exchanges.get('d'):
                label = '过去式/过去分词'
            result.append({'label': label, 'word': value})
    return result[:3]

PREFIXES = ['counter', 'under', 'super', 'inter', 'trans', 'over', 'after', 'fore', 'anti',
            'non', 'pre', 'post', 'sub', 'dis', 'mis', 'out', 'un', 're']
SUFFIXES = ['ability', 'ibility', 'ation', 'ition', 'ment', 'ness', 'ship', 'hood',
            'able', 'ible', 'less', 'ful', 'ous', 'ive', 'ity', 'tion', 'sion', 'ism', 'ist', 'ly']

def spelling_breakdown(head):
    """Conservative visual chunks. These are explicitly not presented as etymology."""
    clean = head.lower()
    if not re.fullmatch(r'[a-z-]+', clean):
        return ''
    if '-' in clean:
        return '·'.join(part for part in clean.split('-') if part)
    for prefix in PREFIXES:
        base = clean[len(prefix):]
        if clean.startswith(prefix) and len(base) >= 3 and base in known_words:
            return prefix + '·' + base
    for suffix in SUFFIXES:
        stem = clean[:-len(suffix)]
        candidates = [stem, stem + 'e', stem[:-1] + 'y' if stem.endswith('i') else '']
        if clean.endswith(suffix) and len(stem) >= 3 and any(candidate in known_words for candidate in candidates if candidate):
            return stem + '·' + suffix
    return ''

def excerpt(example, head, entry):
    forms = {head.lower()}
    forms.update(pair.split(':', 1)[1].lower() for pair in entry.get('exchange', '').split('/') if ':' in pair)
    tokens = example.split()
    for index, token in enumerate(tokens):
        if token.lower().strip('.,;:!?"') in forms:
            # Start at the target and keep the remaining clause. A sliding window
            # can wrongly join an adjective in a relative clause to the main verb.
            return re.split(r'[,;.!?]', ' '.join(tokens[index:]), maxsplit=1)[0].strip()
    return example.rstrip('.')

missing_pos = []
for row in vocabulary:
    word_id = '-'.join(map(str, row[:3]))
    item = content[word_id]
    head = item['spokenWord']
    entry = dictionary.get(head, {})
    meanings = senses(entry)
    labels = list(dict.fromkeys(label for label, _ in meanings))
    if not labels:
        for line in entry.get('definition', '').split('\\n'):
            match = re.match(r'^([a-z]+)\. ', line)
            if match and match[1] in POS and POS[match[1]] not in labels:
                labels.append(POS[match[1]])
    item['partOfSpeech'] = EXPLICIT_POS.get(head) or ' / '.join(labels)
    if not item['partOfSpeech']:
        missing_pos.append(head)
    item['meaning'] = convert(row[4])
    item['translation'] = convert(item['translation'])
    item['family'] = family_for(head)
    item['wordForms'] = form_items(entry)
    item['breakdown'] = spelling_breakdown(head)
    item['breakdownNote'] = '按字形分段记拼写；只有注明构词含义时才按词义相加。' if item['breakdown'] else ''
    item['core'] = '；'.join(re.split('[,，]', meanings[0][1])[:3]).strip() if meanings else convert(row[4])
    phrase = excerpt(item['example'], head, entry)
    item['memoryPhrase'] = phrase
    item['cue'] = ''
    item['cueLabel'] = '语境联想'
    item['aidSource'] = '词典释义、词形及例句搭配'
    if item['family']:
        item['cue'] = ''
        item['cueLabel'] = '词族关联'
    contrasts = [note for first, second, note in relations['contrasts'] if head in (first, second)]
    item['contrast'] = '\n'.join(contrasts[:2])
    if head in guides:
        item.update(guides[head])
        item['cueLabel'] = '这样关联'
        item['aidSource'] = '针对性理解提示'
    # Avoid displaying a second definition that merely repeats the institution's.
    if re.sub(r'[；;，,\s]', '', item['core']) == re.sub(r'[；;，,\s]', '', item['meaning']):
        item['core'] = ''
    for key in ['core', 'cue', 'family', 'contrast', 'meaning', 'translation', 'breakdown', 'breakdownNote']:
        item[key] = convert(item[key])
    item.pop('exampleSourceLabel', None)
    item.pop('exampleSourceDetail', None)
    item.pop('aidSource', None)

(ROOT / 'data/learning-content.js').write_text('// Generated by build-learning-content.py and build-memory-aids.py\nmodule.exports = ' + json.dumps(content, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
sizes = {f'speech{i:02}': sum(path.stat().st_size for path in (ROOT / f'speech{i:02}').glob('*.mp3')) for i in range(1, 13)}
(ROOT / 'data/audio-sizes.js').write_text('module.exports = ' + json.dumps(sizes) + ';\n', 'utf-8')
print(json.dumps({'words':len(content), 'missingPOS':missing_pos, 'families':sum(bool(i['family']) for i in content.values()),
                  'wordForms':sum(bool(i['wordForms']) for i in content.values()), 'contrasts':sum(bool(i['contrast']) for i in content.values()),
                  'customGuides':len(guides), 'audioBytes':sum(sizes.values())}, ensure_ascii=False))
if missing_pos:
    raise SystemExit('Unresolved part-of-speech records require review.')
