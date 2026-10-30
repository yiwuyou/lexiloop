"""Build optional offline comparison data without changing the source vocabulary.

Usage: python scripts/build-relations.py --project PROJECT --ecdict ECDICT.csv --output OUT.js
ECDICT definition contains WordNet-style definitions, NOT a synonym word list.
Only identical complete definitions with compatible parts of speech make an
automatic semantic edge; incidental English/Chinese word overlap does not.
"""
import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path


MANUAL_GROUPS = [
    ('仔细考虑（动词义）', ['deliberate', 'consider', 'ponder']),
    ('经过深思熟虑的（形容词义）', ['deliberate', 'thoughtful']),
    ('释放', ['liberate', 'release']),
    ('小心、谨慎', ['careful', 'cautious', 'prudent']),
    ('保密的', ['confidential', 'secret']),
    ('评估、估价', ['assess', 'evaluate', 'estimate', 'appraise']),
    ('缓解、减轻', ['alleviate', 'relieve', 'ease', 'mitigate']),
    ('促进、推动', ['foster', 'promote', 'facilitate']),
    ('培养', ['foster', 'cultivate', 'nurture']),
    ('消除、去除', ['eliminate', 'remove', 'eradicate']),
    ('多种多样的', ['diverse', 'various']),
    ('恶化', ['deteriorate', 'worsen']),
    ('移居（emigrate 专指移居国外）', ['emigrate', 'migrate']),
    ('明显的', ['obvious', 'apparent', 'evident', 'manifest']),
    ('明确的', ['explicit', 'definite', 'clear']),
    ('获得、取得', ['acquire', 'obtain', 'gain', 'attain']),
    ('分配', ['allocate', 'distribute', 'assign']),
    ('放弃', ['abandon', 'quit', 'forsake']),
    ('禁止', ['prohibit', 'forbid', 'ban']),
    ('承认', ['acknowledge', 'admit', 'concede']),
    ('拒绝', ['reject', 'refuse', 'decline']),
    ('减少', ['reduce', 'decrease', 'diminish']),
    ('增加', ['increase', 'grow', 'rise']),
    ('扩展、扩大', ['expand', 'extend', 'enlarge']),
    ('保持、维持', ['maintain', 'retain', 'preserve']),
    ('保护', ['protect', 'preserve', 'safeguard']),
    ('证明', ['prove', 'demonstrate', 'testify']),
    ('显示、揭示', ['reveal', 'disclose', 'uncover']),
    ('建议', ['suggest', 'propose', 'recommend']),
    ('强调', ['emphasize', 'emphasise', 'stress', 'underline', 'highlight']),
    ('使信服', ['convince', 'persuade']),
    ('理解、领会', ['understand', 'comprehend', 'grasp']),
    ('重要性', ['importance', 'significance']),
    ('至关重要的', ['crucial', 'vital', 'essential', 'critical']),
    ('巨大的', ['huge', 'enormous', 'immense', 'vast', 'tremendous']),
    ('微小的', ['tiny', 'minute']),
    ('暂时的', ['temporary', 'transient']),
    ('适当、合适的', ['appropriate', 'suitable', 'proper']),
    ('足够的', ['adequate', 'sufficient']),
    ('精确、准确的', ['accurate', 'precise', 'exact']),
    ('富足、丰富的', ['abundant', 'plentiful']),
    ('阻碍', ['hinder', 'obstruct', 'impede', 'hamper']),
    ('限制', ['limit', 'restrict', 'constrain']),
    ('忍受', ['bear', 'endure', 'tolerate', 'stand']),
    ('适应', ['adapt', 'adjust', 'accommodate']),
    ('能力', ['ability', 'capacity', 'capability']),
    ('机会', ['chance', 'opportunity']),
    ('目标', ['aim', 'goal', 'objective', 'target']),
    ('方法、方式', ['method', 'approach', 'means', 'way']),
    ('观点', ['opinion', 'view', 'viewpoint', 'standpoint']),
    ('后果、结果', ['consequence', 'result', 'outcome']),
    ('影响（动词义）', ['affect', 'influence', 'sway']),
    ('影响（名词义）', ['effect', 'influence', 'impact']),
    ('好处、优势', ['advantage', 'benefit']),
    ('缺点、短处', ['drawback', 'shortcoming', 'disadvantage']),
    ('区别、区分', ['distinguish', 'differentiate', 'discriminate']),
    ('相似的', ['similar', 'alike', 'analogous']),
    ('不同的', ['different', 'distinct', 'diverse']),
    ('消失', ['disappear', 'vanish']),
    ('出现', ['appear', 'emerge', 'arise']),
    ('复杂的', ['complex', 'complicated', 'sophisticated']),
    ('困难、困境', ['difficulty', 'predicament', 'plight']),
    ('害怕、恐惧（名词义）', ['fear', 'terror', 'fright']),
    ('愤怒（名词义）', ['anger', 'rage', 'fury']),
    ('悲伤（名词义）', ['sadness', 'sorrow', 'grief']),
    ('高兴、快乐（名词义）', ['joy', 'delight', 'pleasure']),
    ('怀疑（名词义）', ['doubt', 'suspicion']),
    ('信任（动词义）', ['trust', 'believe']),
    ('可靠的', ['reliable', 'dependable', 'trustworthy']),
    ('诚实、真诚的', ['honest', 'sincere', 'genuine']),
    ('义务、职责', ['duty', 'obligation', 'responsibility']),
    ('可实施、可行的', ['feasible', 'viable', 'practicable']),
    ('模糊、不清楚的', ['vague', 'obscure', 'unclear']),
    ('固执的', ['stubborn', 'obstinate']),
    ('脆弱的', ['fragile', 'vulnerable']),
    ('充满活力的', ['energetic', 'vigorous', 'dynamic']),
    ('热情（名词义）', ['enthusiasm', 'zeal', 'passion']),
    ('财富', ['wealth', 'fortune', 'treasure']),
    ('职业', ['occupation', 'profession', 'vocation']),
    ('支持、支撑（动词义）', ['support', 'sustain', 'uphold']),
    ('放弃抵抗、屈服', ['surrender', 'yield', 'submit']),
    ('战胜', ['overcome', 'defeat']),
    ('超过', ['surpass', 'exceed']),
    ('努力、奋斗（动词义）', ['strive', 'struggle', 'endeavor', 'endeavour']),
    ('帮助、援助（动词义）', ['aid', 'help', 'assist']),
    ('帮助、援助（名词义）', ['aid', 'assistance', 'help']),
    ('鼓励', ['encourage', 'inspire']),
    ('激发、唤起', ['arouse', 'evoke', 'stimulate']),
    ('合作（动词义）', ['cooperate', 'collaborate']),
    ('合作（名词义）', ['cooperation', 'collaboration']),
    ('期望、预期', ['expect', 'anticipate']),
    ('预见', ['foresee', 'anticipate']),
    ('忽视、疏忽', ['neglect', 'ignore', 'overlook']),
    ('记起', ['remember', 'recall', 'recollect']),
    ('调查（动词义）', ['investigate', 'enquire', 'inquire']),
    ('推断', ['infer', 'deduce']),
    ('推迟', ['postpone', 'defer', 'delay']),
    ('持续、延续', ['continue', 'persist', 'last']),
    ('繁荣、兴旺', ['prosper', 'thrive', 'flourish']),
    ('保证（名词义）', ['guarantee', 'warranty']),
    ('保证（动词义）', ['guarantee', 'ensure']),
    ('最终', ['eventually', 'finally']),
    ('此外、而且', ['furthermore', 'moreover']),
    ('尽管如此', ['nevertheless', 'nonetheless']),
    ('有名的', ['famous', 'notable', 'well-known']),
    ('出色的', ['excellent', 'outstanding', 'splendid', 'superb']),
    ('严厉、严格的', ['strict', 'stern', 'rigorous']),
    ('偏远的', ['distant', 'remote']),
    ('环境', ['environment', 'surroundings']),
    ('缺乏、不足（名词义）', ['shortage', 'deficit']),
    ('缺陷、缺点（名词义）', ['defect', 'shortcoming']),
    ('过剩（名词义）', ['excess', 'surplus']),
    ('份额（名词义）', ['share', 'portion']),
    ('营养、滋养（动词义）', ['nourish', 'nurture']),
    ('引述、引用（动词义）', ['quote', 'cite']),
    ('轻蔑（名词义）', ['contempt', 'scorn']),
    ('百分比', ['percent', 'percentage']),
    ('遵守', ['abide', 'observe', 'respect']),
    ('丰富、充足的', ['abundant', 'ample', 'plentiful']),
    ('称赞（动词义）', ['acclaim', 'compliment', 'praise']),
    ('完成', ['accomplish', 'achieve', 'complete', 'fulfill']),
    ('协议（名词义）', ['accord', 'deal', 'pact']),
    ('积聚', ['accumulate', 'gather']),
    ('管理', ['administer', 'govern', 'manage', 'supervise']),
    ('允许', ['allow', 'permit']),
    ('成人（名词义）', ['adult', 'grown-up']),
    ('宣布', ['announce', 'declare', 'proclaim']),
    ('减轻、缓和', ['alleviate', 'ease', 'moderate', 'relieve']),
    ('改变（动词义）', ['alter', 'transform', 'vary']),
    ('高度（altitude 常指海拔）', ['altitude', 'height']),
    ('放大', ['amplify', 'magnify']),
    ('激怒（动词义）', ['anger', 'irritate', 'provoke']),
    ('渴望的', ['anxious', 'eager', 'thirsty']),
    ('吸引力（名词义）', ['appeal', 'charm']),
    ('争论（动词义）', ['argue', 'debate', 'dispute']),
    ('人造的', ['artificial', 'synthetic']),
    ('收集、聚集', ['assemble', 'collect', 'gather']),
    ('假定', ['assume', 'presume', 'suppose']),
    ('承担', ['assume', 'undertake']),
    ('信心', ['assurance', 'confidence', 'faith']),
    ('附上', ['attach', 'enclose']),
    ('照料（动词义）', ['attend', 'tend']),
    ('侍者', ['attendant', 'waiter']),
    ('属性', ['attribute', 'property']),
    ('专家、权威（指人）', ['authority', 'expert', 'specialist']),
    ('察觉到的', ['aware', 'conscious']),
    ('防止、避免', ['avert', 'avoid', 'prevent']),
    ('醒来（动词义）', ['awake', 'wake', 'waken']),
    ('奖品（名词义）', ['award', 'prize']),
    ('背景（名词义）', ['background', 'context', 'setting']),
]

POS_LABELS = {'n': '名词', 'v': '动词', 'vt': '动词', 'vi': '动词',
              'a': '形容词', 'adj': '形容词', 's': '形容词',
              'adv': '副词', 'ad': '副词', 'r': '副词', 'prep': '介词',
              'conj': '连词', 'pron': '代词', 'num': '数词', 'interj': '感叹词',
              'aux': '助动词', 'det': '限定词'}
NAME_PATTERN = re.compile(r'[（(](?:姓氏?|人名|地名)[）)]|男子名|女子名|男名|女名|城市名|国名|缩写|缩略')
POS_RE = re.compile(r'^(n|vt|vi|v|a|adj|s|adv|ad|r|prep|conj|pron|num|interj|aux|det)\.\s*(.*)')

# Reviewed ordinary-use glosses for malformed/missing ECDICT entries and rare
# dictionary senses that would otherwise be misleadingly called "daily use".
# These are supplementary glosses only: source meanings are never modified.
REVIEWED_COMMON = {
    'affordable': '形容词：负担得起的、价格可承受的',
    'air conditioning': '名词：空调、空气调节',
    'anonymous': '形容词：匿名的、不知姓名的',
    'conservative': '形容词：保守的、谨慎的；名词：保守派',
    'core': '名词：核心、中心、果核；形容词：核心的；动词：去掉果核',
    'coronavirus': '名词：冠状病毒',
    'data': '名词：数据、资料',
    'internet': '名词：互联网、因特网',
    'ought to': '情态动词短语：应该、应当',
    'owing to': '介词短语：由于、因为',
    'pole': '名词：杆、柱、地极、磁极',
    'polish': '动词：擦亮、磨光、润色；名词：擦亮剂、光泽、精致',
    'confidential': '形容词：机密的、保密的',
    'foster': '动词：培养、促进、代养、抚养；形容词：代养的、寄养的',
    'aid': '名词：帮助、援助；动词：帮助、援助',
    'deliberate': '形容词：故意的、深思熟虑的、不慌不忙的；动词：仔细考虑、商议',
    'liberate': '动词：解放、释放、使摆脱束缚',
    'migrate': '动词：迁徙、迁居、迁移',
    'emigrate': '动词：移居国外、移民出境',
    'release': '动词：释放、发布、发行、排放；名词：释放、发布、发行',
    'tremendous': '形容词：巨大的、极大的、极好的',
    'dread': '动词：害怕、担忧；名词：恐惧、担忧',
    'aural': '形容词：听觉的、耳的',
    'salary': '名词：薪水、薪金',
    'approach': '名词：方法、途径、接近；动词：接近、着手处理',
    'modernisation': '名词：现代化（英式拼写）',
    'viable': '形容词：可行的、能存活的',
    'underlying': '形容词：潜在的、根本的、表面下的',
    'render': '动词：使成为、提供、翻译、表现',
    'venue': '名词：活动场所、举办地点',
    'sibling': '名词：兄弟姐妹',
    'economic': '形容词：经济的、经济上的',
    'sensible': '形容词：明智的、通情达理的',
    'frequent': '形容词：频繁的、经常发生的；动词：常去、常到',
    'awful': '形容词：糟糕的、可怕的、极坏的',
    'glance': '动词：瞥一眼、扫视；名词：一瞥、扫视',
    'gradual': '形容词：逐渐的、渐进的',
    'mute': '形容词：不说话的、无声的；动词：使静音、减弱声音',
    'evolution': '名词：进化、演变、发展',
    'mobilise': '动词：动员、调动、组织起来（英式拼写）',
    'specialise': '动词：专门从事、专攻（英式拼写）',
    'steal': '动词：偷、窃取、偷偷移动；名词：划算的买卖、偷窃',
    'account': '名词：账户、账目、说明、叙述；动词：解释、认为',
    'power': '名词：权力、电力、力量、能力；动词：为……提供动力',
    'volume': '名词：体积、容量、音量、一卷、一册、量',
    'sense': '名词：感觉、意义、道理、意识；动词：感知、察觉',
    'script': '名词：剧本、脚本、笔迹；动词：为……写剧本',
    'romance': '名词：爱情、恋爱、浪漫故事',
    'rest': '名词：休息、其余部分；动词：休息、停留',
    'workout': '名词：体育锻炼、健身训练',
    'voluntary': '形容词：自愿的、自发的、志愿的',
    'automatic': '形容词：自动的、不假思索的',
    'mankind': '名词：人类',
    'masculine': '形容词：男性的、有男子气概的、语法上阳性的',
    'active': '形容词：积极的、活跃的、活动的',
    'available': '形容词：可获得的、可利用的、有空的',
    'competent': '形容词：有能力的、能胜任的',
    'significant': '形容词：显著的、重要的、有意义的',
    'virtual': '形容词：虚拟的、实质上的',
    'reflect': '动词：反映、反射、认真思考',
}

# Definitions for old/rare senses are unsuitable for this ordinary-use compare
# view even if ECDICT happens to share their definition text.
REJECT_AUTO = {frozenset(pair) for pair in [
    ('awful', 'dread'), ('dread', 'terrible'), ('terrible', 'tremendous'),
    ('civilise', 'educate'), ('employ', 'employment'), ('media', 'medium'),
    ('parcel', 'portion'),
    ('automatic', 'voluntary'), ('appoint', 'nominate'),
]}


def load_js(path):
    return json.loads(path.read_text('utf-8').split('module.exports', 1)[1].lstrip(' =').rstrip(';\r\n'))


def parse_translation(entry, simplify):
    """Keep general dictionary entries; do not relabel specialist/name senses as daily use."""
    result = []
    for line in entry.get('translation', '').replace('\\n', '\n').splitlines():
        line = simplify(line.strip())
        match = POS_RE.match(line)
        if not match or NAME_PATTERN.search(line):
            continue
        pos, text = match.groups()
        if re.match(r'^\s*[\[【]', text):
            continue
        # Bracketed domain labels after a general gloss begin a specialist tail.
        text = re.split(r'[\[【]', text, maxsplit=1)[0].strip()
        bits = [bit.strip() for bit in re.split('[,，;；]', text) if re.search('[\u4e00-\u9fff]', bit)]
        bits = [bit for bit in bits if not NAME_PATTERN.search(bit)]
        if bits:
            result.append((POS_LABELS[pos], bits[:5]))
    return result


def definitions(entry):
    result = []
    for line in entry.get('definition', '').replace('\\n', '\n').splitlines():
        match = re.match(r'^([nvasr])\.?\s+(.+)', line.strip())
        if not match:
            continue
        pos, sense = match.groups()
        sense = re.sub(r'[^a-z0-9\s]', ' ', sense.lower())
        sense = re.sub(r'\s+', ' ', sense).strip()
        # Reject ultra-generic fragments. Complete multiword definitions only.
        if len(sense.split()) >= 4 and len(sense) >= 22:
            result.append(('a' if pos == 's' else pos, sense))
    return result


def apply_reviewed_pairs(data, pairs, heads):
    """Explicit, symmetric sense links; never infer transitive synonymy."""
    synonyms = {head: {link['word']: link for link in links}
                for head, links in data['synonyms'].items()}
    seen = set()
    for pair in pairs:
        left, right = pair['words']
        key = tuple(sorted((left, right)))
        if left == right or left not in heads or right not in heads or key in seen:
            raise ValueError('Invalid or duplicate reviewed semantic pair: ' + repr(key))
        if not pair.get('sense') or not pair.get('note') or not pair.get('sources'):
            raise ValueError('Reviewed pairs need a shared sense, usage note and sources')
        seen.add(key)
        for source, target in [(left, right), (right, left)]:
            synonyms.setdefault(source, {})[target] = {
                'word': target, 'sense': pair['sense'], 'note': pair['note']}
    data['synonyms'] = {head: [links[target] for target in sorted(links)]
                        for head, links in sorted(synonyms.items()) if links}
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--ecdict', type=Path)
    parser.add_argument('--reviewed-only', action='store_true', help='Apply checked pairs to an existing offline corpus without replacing dictionary data')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    project = args.project
    if args.reviewed_only:
        vocab = load_js(project / 'data/vocabulary.js')
        content = load_js(project / 'data/learning-content.js')
        heads = {content['-'.join(map(str, row[:3]))]['spokenWord'].lower() for row in vocab}
        pairs = json.loads((project / 'data/word-relations.json').read_text('utf-8')).get('semanticPairs', [])
        data = apply_reviewed_pairs(load_js(args.output), pairs, heads)
        args.output.write_text('// ECDICT glosses + reviewed meaning groups; exact-definition semantic edges.\nmodule.exports = ' +
            json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
        audit_path = args.output.with_suffix('.audit.json')
        report = json.loads(audit_path.read_text('utf-8')) if audit_path.exists() else {}
        report.update({'synonymHeads': len(data['synonyms']),
            'directedSynonymEdges': sum(map(len, data['synonyms'].values())),
            'reviewedSemanticPairs': len(pairs), 'bytes': args.output.stat().st_size})
        report.setdefault('spotChecks', {}).update({head: {'common': data['common'][head], 'synonyms': data['synonyms'].get(head, [])}
            for head in sorted({word for pair in pairs for word in pair['words']})})
        audit_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(json.dumps({key: report[key] for key in ['synonymHeads', 'directedSynonymEdges', 'reviewedSemanticPairs', 'bytes']}))
        return
    if not args.ecdict:
        parser.error('--ecdict is required for a full dictionary build')
    sys.path.insert(0, str(args.ecdict.parent / 'tools'))
    try:
        from opencc import OpenCC
        simplify = OpenCC('t2s').convert
    except ImportError:
        simplify = lambda value: value
    vocab = load_js(project / 'data/vocabulary.js')
    content = load_js(project / 'data/learning-content.js')
    heads = {content['-'.join(map(str, row[:3]))]['spokenWord'].lower() for row in vocab}
    dictionary = {}
    with args.ecdict.open(encoding='utf-8', newline='') as stream:
        for entry in csv.DictReader(stream):
            if entry['word'].lower() in heads and entry['word'] == entry['word'].lower():
                dictionary[entry['word']] = entry
    parsed = {head: parse_translation(dictionary.get(head, {}), simplify) for head in heads}
    common = {}
    for head in sorted(heads):
        seen = set()
        lines = []
        for pos, bits in parsed[head]:
            line = pos + '：' + '、'.join(bits)
            if line not in seen:
                seen.add(line)
                lines.append(line)
        common[head] = REVIEWED_COMMON.get(head) or '；'.join(lines[:4]) or '暂无可靠常用释义'

    edges = defaultdict(dict)
    def add(a, b, sense):
        if a != b and a in heads and b in heads:
            edges[a].setdefault(b, sense)
            edges[b].setdefault(a, sense)
    for sense, members in MANUAL_GROUPS:
        for i, a in enumerate(members):
            for b in members[i+1:]:
                add(a, b, sense)

    groups = defaultdict(set)
    for head, entry in dictionary.items():
        for key in definitions(entry):
            groups[key].add(head)
    auto_count = 0
    for (pos, definition), members in groups.items():
        if not 2 <= len(members) <= 10:
            continue
        members = sorted(members)
        for i, a in enumerate(members):
            for b in members[i+1:]:
                apos = {'n': '名词', 'v': '动词', 'a': '形容词', 'r': '副词'}[pos]
                agloss = {bit for label, bits in parsed[a] if label == apos for bit in bits}
                bgloss = {bit for label, bits in parsed[b] if label == apos for bit in bits}
                shared = sorted(agloss & bgloss, key=lambda x: (len(x), x))
                # ECDICT sometimes gives inflected headwords their stem's verb
                # definitions (provided, proceedings, striking). Require a common
                # Chinese entry for the definition's POS and a shared Chinese gloss
                # as an independent guard, so these do not leak into the UI.
                shared = [s for s in shared if len(s.rstrip('的地')) >= 2]
                if shared and b not in edges[a] and frozenset((a, b)) not in REJECT_AUTO:
                    add(a, b, shared[0] + '（' + apos + '义）')
                    auto_count += 1

    relations = json.loads((project / 'data/word-relations.json').read_text('utf-8'))
    families = []
    for family in relations['families']:
        members = list(dict.fromkeys(word.lower() for word in family if word.lower() in heads))
        if len(members) >= 2:
            families.append(members)
    # Inflection/derivation belongs in the structural block, not synonymy.
    for family in [['media', 'medium'], ['employ', 'employment']]:
        if all(head in heads for head in family) and not any(set(family) <= set(group) for group in families):
            families.append(family)
    contrasts = [pair for pair in relations['contrasts'] if pair[0].lower() in heads and pair[1].lower() in heads]
    # Deliberate and liberate share letters but NOT the same historical root.
    contrasts.append(['deliberate', 'liberate',
        'deliberate（深思熟虑的；故意的／仔细考虑）比 liberate（解放；释放）多开头 de；共同字母 liberate 仅用于拼写对照，不代表含义相同，也不要把 de- 当成可推导这两个词的前缀。'])
    data = {'common': common, 'synonyms': {head: [{'word': target, 'sense': sense}
            for target, sense in sorted(targets.items())] for head, targets in sorted(edges.items()) if targets},
            'families': families, 'contrasts': contrasts}
    data = apply_reviewed_pairs(data, relations.get('semanticPairs', []), heads)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('// ECDICT glosses + reviewed meaning groups; exact-definition semantic edges.\nmodule.exports = ' +
        json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
    report = {'sourceRecords': len(vocab), 'heads': len(heads),
        'reviewedCommonCount': len(set(REVIEWED_COMMON) & heads),
        'reviewedSemanticPairs': len(relations.get('semanticPairs', [])),
        'commonAvailable': sum(value != '暂无可靠常用释义' for value in common.values()),
        'synonymHeads': len(data['synonyms']), 'directedSynonymEdges': sum(map(len, data['synonyms'].values())),
        'automaticUndirectedEdges': auto_count, 'families': len(families), 'contrasts': len(contrasts),
        'bytes': args.output.stat().st_size,
        'missingCommon': [head for head, value in common.items() if value == '暂无可靠常用释义'],
        'spotChecks': {head: {'common': common.get(head), 'synonyms': data['synonyms'].get(head, [])}
            for head in ['deliberate', 'liberate', 'release', 'confidential', 'foster', 'aid', 'migrate']},
        'negativePairs': {a + '/' + b: b in edges.get(a, {}) for a, b in [
            ('deliberate', 'liberate'), ('confident', 'confidential'), ('adapt', 'adopt'),
            ('effect', 'affect'), ('explicit', 'implicit'), ('converge', 'diverge'),
            ('economic', 'economical'), ('form', 'from'), ('desert', 'dessert'),
            ('civilise', 'educate'), ('employ', 'employment'), ('media', 'medium'),
            ('parcel', 'portion'), ('defeat', 'surpass'), ('overcome', 'surpass'),
            ('awful', 'dread'), ('dread', 'terrible'), ('terrible', 'tremendous'),
            ('automatic', 'voluntary'), ('appoint', 'nominate')]}}
    audit_path = args.output.with_suffix('.audit.json')
    audit_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
