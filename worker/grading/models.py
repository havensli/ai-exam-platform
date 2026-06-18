from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class EvidenceRef(BaseModel):
    file_path: str
    line_start: int
    line_end: int
    snippet: str = Field(max_length=2000)  # ≤20 lines of code

    @field_validator('line_end')
    @classmethod
    def end_after_start(cls, v: int, info) -> int:
        start = info.data.get('line_start', 0)
        if v < start:
            raise ValueError('line_end must be >= line_start')
        return v


class RubricItemScore(BaseModel):
    rubric_item_id: str
    rubric_item_name: str
    max_score: int = Field(gt=0)
    score: Decimal = Field(ge=Decimal('0'))
    reasoning: str = Field(max_length=500)
    evidence_refs: list[EvidenceRef] = []
    is_core_item: bool
    confidence: str = Field(pattern=r'^(high|medium|low)$')

    @field_validator('score')
    @classmethod
    def score_within_max(cls, v: Decimal, info) -> Decimal:
        max_s = info.data.get('max_score')
        if max_s is not None and v > Decimal(str(max_s)):
            raise ValueError(f'score {v} exceeds max_score {max_s}')
        return v


class AmbiguousRuleAssessment(BaseModel):
    rule_description: str
    candidate_assumption: str
    is_reasonable: bool
    comment: str


class GradingReport(BaseModel):
    submission_id: str
    prompt_version_id: str
    total_score: Decimal
    max_total_score: int
    item_scores: list[RubricItemScore]
    overall_summary: str = Field(max_length=1000)
    ambiguous_rule_assessments: list[AmbiguousRuleAssessment] = []
    grading_warnings: list[str] = []
