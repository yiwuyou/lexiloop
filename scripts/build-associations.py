"""Publish only reviewed, spelling-linked memory routes.

This step is intentionally atomic: it audits a deep copy first and does not
touch the runtime learning-content file unless every vocabulary head passes.
Phrase chunks, example paraphrases and unrelated scenes are not substitutes
for a form-to-meaning mnemonic.
"""
import copy
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTENT_PATH = ROOT / 'data/learning-content.js'
AUDIT_PATH = ROOT / 'scripts/work/association-audit.json'
BANNED_FALLBACKS = re.compile(r'整块记|把这幕定格|记住例句|例句片段')


def load_content():
    source = CONTENT_PATH.read_text('utf-8')
    return json.loads(source.split('module.exports', 1)[1].lstrip(' =').rstrip(';\r\n'))


def normalized_letters(value):
    return ''.join(re.findall(r'[a-z]', (value or '').lower()))


def audit_route(item):
    head = item.get('spokenWord', '')
    breakdown = item.get('breakdown', '')
    note = item.get('breakdownNote', '')
    cue = item.get('cue', '')
    reasons = []

    if not item.get('reviewedGuide'):
        reasons.append('未通过逐词人工审核')

    if not breakdown:
        reasons.append('缺少拆解')
    elif normalized_letters(breakdown) != normalized_letters(head):
        reasons.append('拆解没有逐字覆盖单词拼写')

    if not note:
        reasons.append('缺少由字母/读音直达词义的助记')
    elif BANNED_FALLBACKS.search(note):
        reasons.append('仍是短语、例句或无关画面兜底')

    if cue and BANNED_FALLBACKS.search(cue):
        reasons.append('主钩子仍是短语、例句或无关画面兜底')

    return reasons


def main():
    original = load_content()
    candidate = copy.deepcopy(original)
    blocked = []
    publishable = []

    for key, item in candidate.items():
        reasons = audit_route(item)
        if reasons:
            blocked.append({
                'key': key,
                'word': item.get('spokenWord', ''),
                'reasons': reasons,
                'breakdown': item.get('breakdown', ''),
                'breakdownNote': item.get('breakdownNote', ''),
            })
            continue

        # The decomposed mnemonic already lives in breakdownNote. Storing the
        # same text again as associationHint inflated the main package by more
        # than WeChat's 2 MB limit and rendered duplicate rows. Keep only an
        # independently reviewed secondary cue when one exists; words without
        # one still show the complete breakdown mnemonic.
        item.pop('associationHint', None)
        item['associationLabel'] = item.get('associationLabel') or '拆解助记'
        item.pop('associationPeer', None)
        item.pop('associationKind', None)
        item.pop('memoryPhrase', None)
        item.pop('cueLabel', None)
        publishable.append(item.get('spokenWord', ''))

    report = {
        'total': len(candidate),
        'publishable': len(publishable),
        'blocked': len(blocked),
        'blockedItems': blocked,
    }
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    AUDIT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')

    print(json.dumps({key: report[key] for key in ('total', 'publishable', 'blocked')},
                     ensure_ascii=False))
    if blocked:
        raise SystemExit(
            f'Quality gate blocked publishing: {len(blocked)} words still need reviewed mnemonics.'
        )

    CONTENT_PATH.write_text(
        '// Generated learning content with reviewed spelling-linked memory routes\n'
        'module.exports = '
        + json.dumps(candidate, ensure_ascii=False, separators=(',', ':'))
        + ';\n',
        'utf-8',
    )


if __name__ == '__main__':
    main()
