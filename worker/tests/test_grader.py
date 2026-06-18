import json
from decimal import Decimal

from grading.grader import build_prompt, validate_and_warn_evidence
from grading.models import EvidenceRef, GradingReport, RubricItemScore

TEMPLATE = (
    '考试：{{exam_title}}\n'
    '背景：{{exam_background}}\n'
    '考点：\n{{rubric_items}}\n'
    '隐藏提示：\n{{hidden_notes}}\n'
    '沙箱结果：{{sandbox_summary}}\n'
    '自动检测：{{auto_check_summary}}\n'
)


def test_build_prompt_substitutes_all_placeholders():
    prompt = build_prompt(
        template=TEMPLATE,
        exam={'title': '后端开发考试', 'background': '实现一个 REST API'},
        rubric_items=[
            {'name': '正确性', 'weight': 10, 'is_core': True, 'criteria_text': '接口返回正确结果', 'hidden_notes': '注意边界情况'},
            {'name': '代码风格', 'weight': 5, 'is_core': False, 'criteria_text': '命名规范', 'hidden_notes': None},
        ],
        sandbox_results=[
            {'phase': 'run', 'returncode': 0, 'timed_out': False, 'oom_killed': False},
        ],
        auto_check_results=[
            {'check_name': 'url_accessibility', 'passed': True},
        ],
    )

    assert '{{' not in prompt
    assert '考试：后端开发考试' in prompt
    assert '背景：实现一个 REST API' in prompt
    assert '[1] 正确性 (权重 10 分, 核心考点)' in prompt
    assert '评分细则：接口返回正确结果' in prompt
    assert '[2] 代码风格 (权重 5 分, 普通考点)' in prompt
    assert '正确性：注意边界情况' in prompt
    # Item without hidden_notes must not appear in the hidden notes section
    assert '代码风格：' not in prompt

    sandbox_line = next(line for line in prompt.splitlines() if line.startswith('沙箱结果：'))
    sandbox_summary = json.loads(sandbox_line.split('沙箱结果：', 1)[1])
    assert sandbox_summary == [{'phase': 'run', 'returncode': 0, 'timed_out': False, 'oom_killed': False}]


def test_build_prompt_uses_placeholder_when_no_hidden_notes():
    prompt = build_prompt(
        template='{{hidden_notes}}',
        exam={},
        rubric_items=[{'name': 'X', 'weight': 1, 'is_core': False, 'criteria_text': 'y', 'hidden_notes': None}],
        sandbox_results=[],
        auto_check_results=[],
    )
    assert prompt == '（无）'


def _report(**overrides):
    defaults = dict(
        submission_id='sub-1',
        prompt_version_id='pv-1',
        total_score=Decimal('8'),
        max_total_score=10,
        item_scores=[],
        overall_summary='ok',
    )
    defaults.update(overrides)
    return GradingReport(**defaults)


def test_validate_and_warn_evidence_keeps_valid_refs(tmp_path):
    (tmp_path / 'main.py').write_text('a\nb\nc\n')
    item = RubricItemScore(
        rubric_item_id='r1', rubric_item_name='正确性', max_score=10, score=Decimal('8'),
        reasoning='good', is_core_item=True, confidence='high',
        evidence_refs=[EvidenceRef(file_path='main.py', line_start=1, line_end=2, snippet='a\nb')],
    )
    report = validate_and_warn_evidence(_report(item_scores=[item]), str(tmp_path))
    assert len(report.item_scores[0].evidence_refs) == 1
    assert report.grading_warnings == []


def test_validate_and_warn_evidence_strips_invalid_refs_and_warns(tmp_path):
    (tmp_path / 'main.py').write_text('a\nb\nc\n')
    item = RubricItemScore(
        rubric_item_id='r1', rubric_item_name='正确性', max_score=10, score=Decimal('8'),
        reasoning='good', is_core_item=True, confidence='high',
        evidence_refs=[
            EvidenceRef(file_path='main.py', line_start=1, line_end=2, snippet='a\nb'),
            EvidenceRef(file_path='missing.py', line_start=1, line_end=2, snippet='x\ny'),
        ],
    )
    report = validate_and_warn_evidence(_report(item_scores=[item]), str(tmp_path))
    assert len(report.item_scores[0].evidence_refs) == 1
    assert report.item_scores[0].evidence_refs[0].file_path == 'main.py'
    assert len(report.grading_warnings) == 1
    assert 'missing.py' in report.grading_warnings[0]
