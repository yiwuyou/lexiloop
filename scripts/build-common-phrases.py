"""Build a compact, dictionary-backed common-phrase subpackage.

The main package is already close to WeChat's 2 MB limit, so common phrases
live in their own on-demand subpackage. Reviewed overrides win. Automatic
entries are selected only from ECDICT's translated multiword headwords and
must recur in independent corpora; the example sentence is only a ranking
signal, never copied wholesale as a fake collocation.
"""
import csv
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'scripts' / 'work'
AUDIT_PATH = WORK / 'phrase-audit.json'
sys.path.insert(0, str(WORK / 'tools'))
import nltk
nltk.data.path.insert(0, str(WORK / 'nltk_data'))
from nltk import pos_tag
from nltk.corpus import brown, reuters


def load_js(path):
    source = path.read_text('utf-8')
    return json.loads(source.split('module.exports', 1)[1].lstrip(' =').rstrip(';\r\n'))


vocabulary = load_js(ROOT / 'data/vocabulary.js')
content = load_js(ROOT / 'data/learning-content.js')
reviewed = json.loads((ROOT / 'data/reviewed-phrases.json').read_text('utf-8'))
heads = {item['spokenWord'].lower() for item in content.values()}
simple_heads = {head for head in heads if re.fullmatch(r"[a-z][a-z'-]*", head)}

FUNCTION_WORDS = {
    'a', 'an', 'the', 'be', 'to', 'of', 'for', 'from', 'in', 'into', 'on', 'at',
    'by', 'with', 'without', 'up', 'down', 'out', 'off', 'over', 'under', 'through',
    'and', 'or', 'as', 'than', 'that', 'one', "one's", 'ones', 'sb', 'sth',
}
USEFUL_LEADS = {
    'be', 'come', 'fall', 'get', 'give', 'go', 'have', 'in', 'keep', 'make', 'on',
    'put', 'set', 'take', 'to', 'under', 'with', 'without',
}
BAD_EDGES = {
    'a', 'an', 'the', 'and', 'or', 'but', 'that', 'this', 'these', 'those', 'my',
    'your', 'his', 'her', 'its', 'our', 'their', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'me', 'him', 'them', 'who', 'which', 'what', 'when', 'if',
    'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would',
}
BAD_TRAILS = BAD_EDGES | {'to', 'of', 'for', 'from', 'in', 'on', 'at', 'by', 'with', 'as'}
GENERIC_COLLOCATES = {
    'much', 'many', 'more', 'most', 'less', 'little', 'lot', 'lots', 'important',
    'main', 'whole', 'fair', 'cheap', 'high', 'low', 'basic', 'extra', 'simple',
    'good', 'bad', 'new', 'old', 'big', 'small', 'not', 'very', 'really',
    'is', 'are', 'was', 'were', 'has', 'had', "isn't", "aren't", "wasn't",
    "weren't", "hasn't", "hadn't",
}
CHINESE_FUNCTIONS = {
    'be': '是', 'in': '在', 'into': '进入', 'on': '在', 'at': '在', 'by': '由',
    'to': '向', 'of': '的', 'for': '为', 'from': '从', 'with': '与',
    'without': '没有', 'against': '抵抗', 'over': '超过', 'under': '在……下',
    'up': '向上', 'down': '向下', 'out': '向外', 'off': '离开',
    "one's": '某人的', 'someone': '某人', 'something': '某事',
}
BANNED_PHRASES = {
    'as active', 'as modest', 'as optimistic', 'audio video', 'beat generation',
    'access memory', 'chart support', 'data in', 'federal express', 'finally got', 'house panel',
    'in plant', "it's rude", 'lead manager', 'nominal share capital',
    'passion play', 'personal abuse', 'proper time', 're register', 'release monday', 'remove all',
    'spoke scarcely', 'stranger spoke', 'to collect', 'trip worthwhile',
    'undergraduate studying', 'visit australia',
}


def tokens(value):
    return re.findall(r"[a-z]+(?:'[a-z]+)?", value.lower())


def acceptable_phrase(english, chinese):
    if english in BANNED_PHRASES:
        return False
    if re.search(r'过去式|现在式|过去分词|缩写|\b(?:pron|pref|abbr|na|un)\.', chinese, re.I):
        return False
    if any(token in english.split() for token in {'today', 'tomorrow', 'monday'}):
        return False
    if english.startswith('as ') and english not in {'as usual', 'as well'}:
        return False
    return bool(re.search(r'[\u4e00-\u9fff]', chinese))


def clean_translation(value):
    value = value.split('\\n', 1)[0]
    value = re.sub(r'\[[^]]*\]|<[^>]*>', '', value)
    value = re.sub(r'^\s*(?:n|v|vt|vi|adj|adv|prep|conj|a|s|ad|r)\.\s*', '', value, flags=re.I)
    value = value.replace(',', '；').replace('，', '；').replace(';', '；')
    value = re.sub(r'(?:\.{2,}|。{2,})', '……', value)
    value = re.sub(r'\s+', '', value).strip('；。 ')
    parts = [part for part in value.split('；') if part]
    # A phrase row needs one precise Chinese anchor, not a dump of loosely
    # related dictionary senses. Extra senses are often domain-specific and
    # make a short learning card harder to trust.
    return parts[0] if parts else ''


frequency = {}
glosses = {}
gloss_variants = {}
phrase_rows = []
with (WORK / 'ecdict.csv').open(encoding='utf-8', newline='') as stream:
    for row in csv.DictReader(stream):
        head = row['word'].strip()
        parts = tokens(head)
        if len(parts) == 1:
            rank = int(row['frq']) if row.get('frq', '').isdigit() and int(row['frq']) > 0 else 999999
            frequency[parts[0]] = min(frequency.get(parts[0], 999999), rank)
            translation = clean_translation(row.get('translation', ''))
            if translation:
                glosses[parts[0]] = translation.split('；', 1)[0]
                raw = row.get('translation', '').split('\\n', 1)[0]
                raw = re.sub(r'\[[^]]*\]|<[^>]*>', '', raw)
                values = []
                for value in re.split(r'[,，;；]', raw):
                    value = re.sub(r'^\s*(?:n|v|vt|vi|adj|adv|prep|conj|pron|a|s|ad|r)\.\s*', '', value, flags=re.I)
                    value = re.sub(r'\([^)]*\)', '', value)
                    value = re.sub(r'[A-Za-z]+\.?', '', value)
                    value = re.sub(r'\s+', '', value).strip('；。 ，')
                    if re.fullmatch(r'[\u4e00-\u9fff…·]+', value or '') and 1 < len(value) <= 10:
                        values.append(value)
                if values:
                    gloss_variants[parts[0]] = list(dict.fromkeys(values))
            continue
        if not 2 <= len(parts) <= 3 or not row.get('translation', '').strip():
            continue
        if re.search(r'\d|[/=+]', head) or any(len(token) == 1 and token not in {'a', 'i'} for token in parts):
            continue
        if any(token in BAD_EDGES | {'whoever', 'whatever', 'whether'} for token in parts):
            continue
        if any(token in GENERIC_COLLOCATES for token in parts):
            continue
        translation = clean_translation(row['translation'])
        if not translation or not re.search(r'[\u4e00-\u9fff]', translation) or len(translation) > 30:
            continue
        contained = simple_heads.intersection(parts)
        if contained:
            trusted = (row.get('collins', '').isdigit() and int(row['collins']) > 0) or bool(row.get('oxford', '').strip())
            phrase_rows.append((head.lower(), parts, translation, contained, trusted))


forms_by_head = {}
head_by_form = {}
for item in content.values():
    head = item['spokenWord'].lower()
    forms = {head}
    forms.update(form['word'].lower() for form in item.get('wordForms', []))
    forms_by_head[head] = forms
    for form in forms:
        if re.fullmatch(r"[a-z][a-z'-]*", form):
            head_by_form.setdefault(form, head)


def normalized_example(item):
    head = item['spokenWord'].lower()
    return ' '.join(head if token in forms_by_head.get(head, {head}) else token
                    for token in tokens(item.get('example', '')))


examples = {item['spokenWord'].lower(): normalized_example(item) for item in content.values()}
candidates = defaultdict(list)
for phrase, parts, translation, contained, trusted in phrase_rows:
    normalized = ' '.join(parts)
    for head in contained:
        position = parts.index(head)
        # A useful learning chunk normally starts/ends with the headword, or
        # places it after a short grammatical lead (be/in/have/etc.).
        if position not in (0, len(parts) - 1) and not (position == 1 and parts[0] in USEFUL_LEADS):
            continue
        if any(frequency.get(token, 999999) > 30000 for token in parts
               if token != head and token not in FUNCTION_WORDS):
            continue
        score = 80 - (len(parts) - 2) * 7
        if position == 0:
            score += 22
        elif position == len(parts) - 1:
            score += 14
        if parts[0] in USEFUL_LEADS:
            score += 12
        example = examples.get(head, '')
        if normalized in example:
            score += 20
        elif all(token in example.split() for token in parts if token not in FUNCTION_WORDS):
            score += 18
        for token in parts:
            if token == head or token in FUNCTION_WORDS:
                continue
            rank = frequency.get(token, 999999)
            score += 10 if rank <= 1500 else 6 if rank <= 6000 else 2 if rank <= 15000 else -5
        if len(translation) <= 16:
            score += 4
        candidates[head].append((score, normalized, translation, trusted))


def compact_meaning(item):
    return re.split(r'[；;,，]', item.get('meaning', ''))[0].strip()


def contextual_meaning(item):
    sentence = re.sub(r'\s+', '', item.get('translation', ''))
    meanings = [part.strip() for part in re.split(r'[；;,，]', item.get('meaning', '')) if part.strip()]
    for meaning in meanings:
        plain = re.sub(r'[（）()…\s]', '', meaning)
        plain = re.sub(r'(性的|性|的|地)$', '', plain)
        if len(plain) >= 2 and plain in sentence:
            return meaning
    return meanings[0] if len(meanings) == 1 else ''


def possible_lemmas(token):
    values = [head_by_form.get(token, token), token]
    if token.endswith('ies') and len(token) > 4:
        values.append(token[:-3] + 'y')
    if token.endswith('es') and len(token) > 3:
        values.extend([token[:-2], token[:-1]])
    elif token.endswith('s') and len(token) > 3:
        values.append(token[:-1])
    if token.endswith('ed') and len(token) > 4:
        values.extend([token[:-2], token[:-1]])
    if token.endswith('ing') and len(token) > 5:
        values.extend([token[:-3], token[:-3] + 'e'])
    return list(dict.fromkeys(values))


def contextual_gloss(token, sentence):
    compact_sentence = re.sub(r'\s+', '', sentence)
    candidates = []
    for lemma in possible_lemmas(token):
        candidates.extend(gloss_variants.get(lemma, []))
    candidates = list(dict.fromkeys(candidates))
    for value in candidates:
        plain = value.replace('…', '')
        plain = re.sub(r'(性的|性|的|地)$', '', plain)
        if len(plain) >= 2 and plain in compact_sentence:
            return value
    return candidates[0] if len(candidates) == 1 else ''


def phrase_windows(item):
    """Return conservative POS-backed chunks around the word in its example.

    These are deliberately patterns, not arbitrary sliding windows.  A missing
    phrase is preferable to snippets such as ``absence gave`` or ``much
    bureaucracy`` that happen to sit next to the headword in a sentence.
    """
    head = item['spokenWord'].lower()
    forms = forms_by_head.get(head, {head})
    words = tokens(item.get('example', ''))
    tagged = pos_tag(words)
    positions = [index for index, token in enumerate(words) if token in forms]
    result = []

    def add(start, end, base_score):
        if start < 0 or end > len(words) or end - start < 2 or end - start > 3:
            return
        chunk = words[start:end]
        if chunk[0] in BAD_EDGES or chunk[-1] in BAD_TRAILS:
            return
        if any(token in {'and', 'or', 'but', 'that', 'which', 'who'} for token in chunk):
            return
        if any(token in GENERIC_COLLOCATES for token in chunk):
            return
        if end < len(words) and tagged[end - 1][1].startswith('NN') and tagged[end][1].startswith('NN'):
            return
        target = next((index for index in range(start, end) if words[index] in forms), None)
        if target is None:
            return
        # Every content word needs a Chinese gloss; otherwise the generated
        # explanation is likely to be incomplete or misleading.
        for index in range(start, end):
            token = words[index]
            tag = tagged[index][1]
            if index == target or token in FUNCTION_WORDS or tag in {'DT', 'PRP$', 'POS'}:
                continue
            if token not in CHINESE_FUNCTIONS and not contextual_gloss(token, item.get('translation', '')):
                return
        surface = tuple(chunk)
        if any(entry['surface'] == surface for entry in result):
            return
        result.append({'surface': surface, 'score': base_score, 'target': target - start})

    for target in positions:
        pos = item.get('partOfSpeech', '')
        tags = [tag for _, tag in tagged]
        target_tag = tags[target]
        # Verb + object; verb + preposition + noun; passive + preposition.
        if target_tag.startswith('VB'):
            if target + 1 < len(words) and tags[target + 1] in {'NN', 'NNS'}:
                add(target, target + 2, 92)
            if target + 2 < len(words) and tags[target + 1] in {'DT', 'PRP$', 'JJ'} and tags[target + 2] in {'NN', 'NNS'}:
                add(target, target + 3, 94)
            if target + 2 < len(words) and tags[target + 1] in {'IN', 'TO', 'RP'} and tags[target + 2].startswith('NN'):
                add(target, target + 3, 96)
        # Stable noun chunks: adjective/noun + noun, verb + noun, noun + of + noun.
        if target_tag.startswith('NN'):
            if target > 0 and (tags[target - 1].startswith('JJ') or tags[target - 1].startswith('NN')):
                add(target - 1, target + 1, 94)
            if target > 0 and tags[target - 1].startswith('VB'):
                add(target - 1, target + 1, 90)
            if target + 1 < len(words) and tags[target + 1].startswith('NN'):
                add(target, target + 2, 90)
            if target + 2 < len(words) and words[target + 1] in {'of', 'in', 'for', 'to'} and tags[target + 2].startswith('NN'):
                add(target, target + 3, 94)
        if target_tag.startswith('JJ'):
            if target + 1 < len(words) and tags[target + 1].startswith('NN'):
                add(target, target + 2, 96)
            if target + 2 < len(words) and words[target + 1] in {'of', 'to', 'for', 'with', 'about'} and tags[target + 2].startswith('NN'):
                add(target, target + 3, 94)
            if target > 0 and tags[target - 1].startswith('RB'):
                add(target - 1, target + 1, 88)
        if target_tag.startswith('RB'):
            if target + 1 < len(words) and (tags[target + 1].startswith('VB') or tags[target + 1].startswith('JJ')):
                add(target, target + 2, 92)
            if target > 0 and tags[target - 1].startswith('VB'):
                add(target - 1, target + 1, 90)
    return result


window_candidates = {head: phrase_windows(item) for head, item in
                     ((item['spokenWord'].lower(), item) for item in content.values())}
wanted_ngrams = {entry['surface'] for entries in window_candidates.values() for entry in entries}
wanted_ngrams.update(tuple(phrase.split()) for entries in candidates.values() for _, phrase, _, _ in entries)
corpus_counts = defaultdict(int)
with zipfile.ZipFile(WORK / 'cmn-eng.zip') as archive:
    for line in archive.read('cmn.txt').decode('utf-8').splitlines():
        sentence = tokens(line.split('\t', 1)[0])
        for length in range(2, 6):
            for start in range(0, len(sentence) - length + 1):
                gram = tuple(sentence[start:start + length])
                if gram in wanted_ngrams:
                    corpus_counts[gram] += 1

# Larger English corpora are used only for occurrence counts.  Their sentences
# are not copied into the product.
for corpus_sentences in (brown.sents(), reuters.sents()):
    for source_sentence in corpus_sentences:
        sentence = [token.lower() for token in source_sentence if re.fullmatch(r"[A-Za-z]+(?:'[A-Za-z]+)?", token)]
        for length in (2, 3):
            for start in range(0, len(sentence) - length + 1):
                gram = tuple(sentence[start:start + length])
                if gram in wanted_ngrams:
                    corpus_counts[gram] += 1


def translate_chunk(chunk, item, target_index):
    chinese_sentence = item.get('translation', '')
    target_meaning = contextual_meaning(item)
    if not target_meaning:
        return ''
    translated = []
    for index, token in enumerate(chunk):
        if index == target_index:
            translated.append(target_meaning)
            continue
        if token in {'a', 'an', 'the'}:
            translated.append('')
            continue
        token = {"my": "one's", "your": "one's", "his": "one's", "her": "one's",
                 "our": "one's", "their": "one's", 'me': 'someone', 'him': 'someone',
                 'them': 'someone'}.get(token, token)
        if token in {'to', 'in', 'into', 'on', 'at', 'by', 'for', 'from', 'with'}:
            translated.append('')
        else:
            translated.append(CHINESE_FUNCTIONS.get(token) or contextual_gloss(token, chinese_sentence))
    if any(not value and token not in FUNCTION_WORDS and token not in {'is', 'are', 'was', 'were'}
           for token, value in zip(chunk, translated)):
        return ''
    # English "X of Y" becomes Chinese "Y 的 X".
    if 'of' in chunk:
        pivot = chunk.index('of')
        left = ''.join(value for value in translated[:pivot] if value)
        right = ''.join(value for value in translated[pivot + 1:] if value)
        if left and right:
            return right + '的' + left
    if chunk and chunk[0] == 'not':
        return '不' + ''.join(value for value in translated[1:] if value)
    return ''.join(value for value in translated if value)


def example_phrase(item):
    head = item['spokenWord'].lower()
    entries = window_candidates.get(head, [])
    for entry in entries:
        count = corpus_counts.get(entry['surface'], 0)
        entry['finalScore'] = entry['score'] + min(30, count * 3)
    entries = [entry for entry in entries if corpus_counts.get(entry['surface'], 0) >= 2]
    ranked = sorted(entries, key=lambda entry: (-entry['finalScore'], len(entry['surface']), entry['surface']))
    if not ranked:
        return ''
    best = ranked[0]
    surface = list(best['surface'])
    target = best['target']
    # Replace personal pronouns with reusable dictionary-style placeholders.
    surface = [{"my": "one's", "your": "one's", "his": "one's", "her": "one's",
                "our": "one's", "their": "one's", 'me': 'someone', 'him': 'someone',
                'them': 'someone'}.get(token, token) for token in surface]
    surface[target] = item['spokenWord'].lower()
    translation = translate_chunk(list(best['surface']), item, target)
    english = ' '.join(surface)
    if (not translation or len(translation) > 22 or re.search(r'[A-Za-z]', translation)
            or re.search(r'(.{2,5})(?:的)?\1', translation)):
        return ''
    if not acceptable_phrase(english, translation):
        return ''
    return f"{english} {translation}".strip()


selected_by_head = {}
source_by_head = {}
for head in heads:
    if head in reviewed:
        selected_by_head[head] = reviewed[head]
        source_by_head[head] = 'reviewed'
        continue
    # Source entries that are already multiword expressions are their own
    # canonical phrase and need no synthetic extension.
    if len(tokens(head)) >= 2:
        item = next(item for item in content.values() if item['spokenWord'].lower() == head)
        selected_by_head[head] = f"{item['spokenWord']} {item.get('meaning', '')}".strip()
        source_by_head[head] = 'headword'
        continue
    ranked = sorted(candidates.get(head, []), key=lambda item: (-item[0], len(item[1]), item[1]))
    example = examples.get(head, '')
    for score, phrase, translation, trusted in ranked:
        count = corpus_counts.get(tuple(phrase.split()), 0)
        # Dictionary entries still need evidence that people actually use the
        # combination. Repeated occurrence avoids promoting a one-off sentence
        # fragment merely because it appears in the source example.
        phrase_tokens = phrase.split()
        open_ended = phrase_tokens[-1] in {'of', 'to', 'for', 'from', 'in', 'on', 'at', 'by', 'with'}
        independently_evidenced = (trusted and count >= 2) or count >= 15
        if (score >= 100 and independently_evidenced
                and (not open_ended or trusted or count >= 15)
                and acceptable_phrase(phrase, translation)):
            selected_by_head[head] = f'{phrase} {translation}'
            source_by_head[head] = 'dictionary'
            break
    if head in selected_by_head:
        continue
    item = next(item for item in content.values() if item['spokenWord'].lower() == head)
    phrase = example_phrase(item)
    if phrase:
        selected_by_head[head] = phrase
        source_by_head[head] = 'example-pos'


packs = {f'speech{index:02}': {} for index in range(1, 13)}
all_phrases = {}
for word_id, item in content.items():
    phrase = selected_by_head.get(item['spokenWord'].lower(), '')
    if phrase:
        packs[item['audioPackage']][word_id] = phrase
        all_phrases[word_id] = phrase

for name in packs:
    (ROOT / name / 'ready.js').write_text(
        "module.exports = { name: '" + name + "' };\n",
        'utf-8',
    )
(ROOT / 'phrase-data' / 'ready.js').write_text(
    'module.exports=' + json.dumps(all_phrases, ensure_ascii=False, separators=(',', ':')) + ';\n',
    'utf-8',
)

uncovered = sorted(head for head in heads if head not in selected_by_head)
report = {
    'records': len(content),
    'uniqueHeads': len(heads),
    'coveredHeads': len(selected_by_head),
    'sourceCounts': {source: list(source_by_head.values()).count(source) for source in sorted(set(source_by_head.values()))},
    'uncoveredHeads': uncovered,
    'packageCounts': {name: len(items) for name, items in packs.items()},
    'packageBytes': {'phrase-data': (ROOT / 'phrase-data' / 'ready.js').stat().st_size},
    'samples': {head: selected_by_head.get(head, '') for head in [
        'accept', 'account', 'confidential', 'derive', 'deteriorate', 'dilemma',
        'explicit', 'expire', 'facilitate', 'fiscal', 'foster', 'migrate',
    ]},
}
AUDIT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
print(json.dumps({key: report[key] for key in ('records', 'uniqueHeads', 'coveredHeads', 'packageCounts', 'packageBytes', 'samples')}, ensure_ascii=False, indent=2))
