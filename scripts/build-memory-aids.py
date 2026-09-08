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
common_words = set()
with (WORK / 'ecdict.csv').open(encoding='utf-8', newline='') as stream:
    for entry in csv.DictReader(stream):
        known_words.add(entry['word'])
        frequency = int(entry['frq']) if entry.get('frq', '').isdigit() else 999999
        is_common = bool(entry.get('collins')) or entry.get('oxford') == '1' or frequency <= 6000
        if is_common:
            common_words.add(entry['word'])
        if entry['word'] in needed or is_common:
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

FAMILIAR_WORDS = heads | common_words | {word for group in relations['families'] for word in group}
PREFIXES = [
    ('counter', '反向或对抗', r'反|对抗|抵消'), ('under', '在下或不足', r'下|低|不足|暗中'),
    ('super', '在上或超出', r'上|超'), ('inter', '在……之间', r'之间|相互|国际|交互'),
    ('trans', '跨越或转变', r'跨|转|变'), ('over', '过度、越过或在上', r'过|越|上'),
    ('after', '在后', r'后'), ('fore', '在前或预先', r'前|预'), ('anti', '反对或抵抗', r'反|抵抗'),
    ('non', '不、非', r'不|无|非'), ('pre', '在前或预先', r'前|预'), ('post', '在后', r'后'),
    ('sub', '在下或次一级', r'下|次|分'), ('dis', '否定、分离或相反', r'不|无|失|反|分|解除|障碍|残疾'),
    ('mis', '错误地', r'错|误|不当'), ('out', '向外或超过', r'外|超过'),
    ('un', '不、无或相反', r'不|无|未|非|难'), ('re', '再次、返回或恢复', r'再|重新|恢复|返回|回|反复|重'),
]
SUFFIXES = [
    ('ability', '名词，表示能力或性质'), ('ibility', '名词，表示能力或性质'),
    ('ation', '名词，表示动作或结果'), ('ition', '名词，表示动作或结果'),
    ('ment', '名词，表示结果或状态'), ('ness', '名词，表示性质或状态'),
    ('ship', '名词，表示身份或状态'), ('hood', '名词，表示时期或状态'),
    ('able', '形容词，表示能够或适合'), ('ible', '形容词，表示能够或适合'),
    ('less', '表示缺少或没有'), ('ful', '表示充满或具有'), ('ous', '构成形容词'),
    ('ive', '构成形容词'), ('ity', '名词，表示性质或状态'), ('tion', '名词，表示动作或结果'),
    ('sion', '名词，表示动作或结果'), ('ism', '名词，表示思想或现象'),
    ('ist', '表示相关的人'), ('ly', '通常构成副词'),
]
COMPOUND_COMPONENTS = {
    'air', 'back', 'ball', 'bank', 'bed', 'blood', 'board', 'book', 'break', 'bridge', 'business',
    'care', 'case', 'child', 'class', 'day', 'door', 'down', 'earth', 'eye', 'face', 'field',
    'fire', 'foot', 'free', 'friend', 'ground', 'hand', 'head', 'health', 'heart', 'home', 'house',
    'land', 'life', 'light', 'line', 'man', 'market', 'master', 'name', 'news', 'night', 'north',
    'out', 'over', 'paper', 'place', 'proof', 'road', 'room', 'school', 'sea', 'self', 'shop',
    'short', 'side', 'sight', 'south', 'space', 'stand', 'stone', 'time', 'tooth', 'town', 'up',
    'water', 'way', 'week', 'wide', 'woman', 'word', 'work', 'world', 'worth', 'year',
}
OPAQUE_SPLITS = {'understand'}

def spelling_breakdown(head, meaning):
    """Return only a defensible familiar-base construction, never an opaque split."""
    clean = head.lower()
    if not re.fullmatch(r'[a-z-]+', clean):
        return '', ''
    if '-' in clean:
        parts = [part for part in clean.split('-') if part]
        return '·'.join(parts), '按单词本身的连字符分段，把各部分合成一个整体记。'
    if clean not in OPAQUE_SPLITS:
        compound = []
        for index in range(3, len(clean) - 2):
            first, second = clean[:index], clean[index:]
            if (first in FAMILIAR_WORDS and second in FAMILIAR_WORDS
                    and (first in COMPOUND_COMPONENTS or second in COMPOUND_COMPONENTS)):
                compound.append((min(len(first), len(second)), first, second))
        if compound:
            _, first, second = max(compound)
            first_gloss, second_gloss = gloss(first), gloss(second)
            labels = first + (f'（{first_gloss}）' if first_gloss else '')
            labels += '＋' + second + (f'（{second_gloss}）' if second_gloss else '')
            return first + '·' + second, f'画面拆记：{labels}；这是记忆画面，不冒充词源。'
    for prefix, prefix_meaning, markers in PREFIXES:
        base = clean[len(prefix):]
        if (clean.startswith(prefix) and len(base) >= 3 and base in FAMILIAR_WORDS
                and re.search(markers, meaning)):
            base_gloss = gloss(base)
            note = f'{prefix}- 表示“{prefix_meaning}”，联系 {base}'
            if base_gloss:
                note += f'（{base_gloss}）'
            return prefix + '·' + base, note + ' 记整体含义。'
    for suffix, suffix_meaning in SUFFIXES:
        stem = clean[:-len(suffix)]
        candidates = [stem, stem + 'e', stem[:-1] + 'y' if stem.endswith('i') else '']
        base = next((candidate for candidate in candidates if candidate and candidate in FAMILIAR_WORDS), '')
        if clean.endswith(suffix) and len(stem) >= 3 and base:
            base_gloss = gloss(base)
            note = f'由 {base}' + (f'（{base_gloss}）' if base_gloss else '')
            return stem + '·' + suffix, note + f' 变来；-{suffix} {suffix_meaning}。'
    return '', ''

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
    item['breakdown'], item['breakdownNote'] = spelling_breakdown(head, item['meaning'])
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
