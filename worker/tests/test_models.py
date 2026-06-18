from decimal import Decimal

import pytest
from pydantic import ValidationError

from grading.models import EvidenceRef, RubricItemScore


def make_evidence(**overrides):
    defaults = dict(file_path='src/app.py', line_start=10, line_end=20, snippet='print(1)')
    defaults.update(overrides)
    return EvidenceRef(**defaults)


def make_score(**overrides):
    defaults = dict(
        rubric_item_id='item-1',
        rubric_item_name='正确性',
        max_score=10,
        score=Decimal('5'),
        reasoning='looks fine',
        is_core_item=True,
        confidence='high',
    )
    defaults.update(overrides)
    return RubricItemScore(**defaults)


class TestEvidenceRef:
    def test_accepts_line_end_after_line_start(self):
        ref = make_evidence(line_start=10, line_end=20)
        assert ref.line_end == 20

    def test_accepts_line_end_equal_to_line_start(self):
        ref = make_evidence(line_start=10, line_end=10)
        assert ref.line_end == 10

    def test_rejects_line_end_before_line_start(self):
        with pytest.raises(ValidationError, match='line_end must be >= line_start'):
            make_evidence(line_start=20, line_end=10)

    def test_rejects_snippet_over_max_length(self):
        with pytest.raises(ValidationError):
            make_evidence(snippet='x' * 2001)


class TestRubricItemScore:
    def test_accepts_score_equal_to_max_score(self):
        score = make_score(max_score=10, score=Decimal('10'))
        assert score.score == Decimal('10')

    def test_accepts_score_below_max_score(self):
        score = make_score(max_score=10, score=Decimal('7.5'))
        assert score.score == Decimal('7.5')

    def test_rejects_score_above_max_score(self):
        with pytest.raises(ValidationError, match='exceeds max_score'):
            make_score(max_score=10, score=Decimal('10.5'))

    def test_rejects_negative_score(self):
        with pytest.raises(ValidationError):
            make_score(score=Decimal('-1'))

    def test_rejects_zero_max_score(self):
        with pytest.raises(ValidationError):
            make_score(max_score=0)

    @pytest.mark.parametrize('confidence', ['high', 'medium', 'low'])
    def test_accepts_valid_confidence_values(self, confidence):
        score = make_score(confidence=confidence)
        assert score.confidence == confidence

    def test_rejects_invalid_confidence_value(self):
        with pytest.raises(ValidationError):
            make_score(confidence='very-high')

    def test_default_evidence_refs_is_empty_list(self):
        score = make_score()
        assert score.evidence_refs == []

    def test_accepts_embedded_evidence_refs(self):
        score = make_score(evidence_refs=[make_evidence().model_dump()])
        assert len(score.evidence_refs) == 1
