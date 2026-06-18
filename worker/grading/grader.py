"""
Orchestrates the full grading pipeline for one submission:
  1. Fetch rubric + prompt version from DB
  2. Build prompt from template
  3. Run first-layer deterministic checks
  4. Run LLM grading agent
  5. Validate evidence refs
  6. Save results to ai_grading_results
  7. Update submission status to 'ai_graded'
"""
from __future__ import annotations

import asyncio
import json
import logging
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg2.extras

from .agent import run_grading
from .first_layer import FirstLayerChecker
from .models import GradingReport

logger = logging.getLogger(__name__)


def fetch_prompt_version(conn, exam_id: str) -> dict[str, Any]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, prompt_template, model_id, rubric_snapshot
            FROM prompt_versions
            WHERE exam_id = %s AND deprecated_at IS NULL
            ORDER BY version DESC
            LIMIT 1
        """, (exam_id,))
        row = cur.fetchone()
    if not row:
        raise ValueError(f'No active prompt version for exam {exam_id}')
    return dict(row)


def fetch_rubric_items(conn, exam_id: str) -> list[dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, weight, criteria_text, is_core, hidden_notes
            FROM rubric_items WHERE exam_id = %s ORDER BY order_index
        """, (exam_id,))
        return [dict(r) for r in cur.fetchall()]


def fetch_sandbox_results(conn, submission_id: str) -> list[dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT phase, returncode, stdout, stderr, timed_out, oom_killed, duration_seconds
            FROM sandbox_run_results WHERE submission_id = %s
        """, (submission_id,))
        return [dict(r) for r in cur.fetchall()]


def fetch_auto_check_results(conn, submission_id: str) -> list[dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT check_name, passed, raw_output
            FROM auto_check_results WHERE submission_id = %s
        """, (submission_id,))
        return [dict(r) for r in cur.fetchall()]


def build_prompt(
    template: str,
    exam: dict[str, Any],
    rubric_items: list[dict[str, Any]],
    sandbox_results: list[dict[str, Any]],
    auto_check_results: list[dict[str, Any]],
) -> str:
    rubric_text = '\n'.join(
        f"- [{i+1}] {item['name']} (权重 {item['weight']} 分, {'核心考点' if item['is_core'] else '普通考点'})\n"
        f"  评分细则：{item['criteria_text']}"
        for i, item in enumerate(rubric_items)
    )
    hidden_notes_text = '\n'.join(
        f"- {item['name']}：{item['hidden_notes']}"
        for item in rubric_items if item.get('hidden_notes')
    ) or '（无）'

    sandbox_summary = json.dumps(
        [{'phase': r['phase'], 'returncode': r['returncode'], 'timed_out': r['timed_out'], 'oom_killed': r['oom_killed']}
         for r in sandbox_results],
        ensure_ascii=False
    )
    auto_summary = json.dumps(
        [{'check': r['check_name'], 'passed': r['passed']} for r in auto_check_results],
        ensure_ascii=False
    )

    return (
        template
        .replace('{{exam_title}}', exam.get('title', ''))
        .replace('{{exam_background}}', exam.get('background', ''))
        .replace('{{rubric_items}}', rubric_text)
        .replace('{{hidden_notes}}', hidden_notes_text)
        .replace('{{sandbox_summary}}', sandbox_summary)
        .replace('{{auto_check_summary}}', auto_summary)
    )


def validate_and_warn_evidence(report: GradingReport, repo_path: str) -> GradingReport:
    from .code_retriever import CodeRetriever
    retriever = CodeRetriever(repo_path)
    warnings = list(report.grading_warnings)

    for item_score in report.item_scores:
        valid_refs = []
        for ref in item_score.evidence_refs:
            if retriever.validate_evidence_ref(ref.file_path, ref.line_start, ref.line_end):
                valid_refs.append(ref)
            else:
                warnings.append(
                    f'Invalid evidence ref in {item_score.rubric_item_name}: '
                    f'{ref.file_path}:{ref.line_start}-{ref.line_end} not found'
                )
        item_score.evidence_refs = valid_refs

    return report.model_copy(update={'grading_warnings': warnings})


def save_grading_results(conn, submission_id: str, report: GradingReport) -> None:
    with conn.cursor() as cur:
        for item in report.item_scores:
            cur.execute("""
                INSERT INTO ai_grading_results
                    (submission_id, rubric_item_id, prompt_version_id, score, max_score, reasoning, evidence_ref)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                submission_id,
                item.rubric_item_id,
                report.prompt_version_id,
                str(item.score),
                str(item.max_score),
                item.reasoning,
                json.dumps([r.model_dump() for r in item.evidence_refs]),
            ))
        cur.execute(
            "UPDATE submissions SET status = 'ai_graded' WHERE id = %s",
            (submission_id,)
        )
    conn.commit()


def save_auto_check_results(conn, results: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        for r in results:
            cur.execute("""
                INSERT INTO auto_check_results (submission_id, check_name, passed, raw_output)
                VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
            """, (r['submission_id'], r['check_name'], r['passed'], r.get('raw_output')))
    conn.commit()


def grade_submission(conn, submission_id: str, repo_path: str) -> GradingReport:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT s.*, e.title, e.background, e.run_command, e.id as exam_id,
                   emp.dingtalk_userid
            FROM submissions s
            JOIN exams e ON e.id = s.exam_id
            JOIN employees emp ON emp.id = s.employee_id
            WHERE s.id = %s
        """, (submission_id,))
        sub = dict(cur.fetchone())

    exam_id = sub['exam_id']
    prompt_version = fetch_prompt_version(conn, exam_id)
    rubric_items = fetch_rubric_items(conn, exam_id)

    # First layer: deterministic checks
    checker = FirstLayerChecker()
    auto_results = checker.run_all_checks(
        submission_id=submission_id,
        deploy_url=sub['deploy_url'],
        repo_path=repo_path,
        employee_dingtalk_id=sub['dingtalk_userid'],
        exam_id=exam_id,
        conn=conn,
        assumption_text=sub.get('assumption_text'),
    )
    save_auto_check_results(conn, auto_results)

    sandbox_results = fetch_sandbox_results(conn, submission_id)
    prompt = build_prompt(
        template=prompt_version['prompt_template'],
        exam={'title': sub['title'], 'background': sub['background']},
        rubric_items=rubric_items,
        sandbox_results=sandbox_results,
        auto_check_results=auto_results,
    )

    report = asyncio.run(run_grading(
        submission_id=submission_id,
        prompt_version_id=str(prompt_version['id']),
        prompt_template=prompt,
        repo_path=repo_path,
        sandbox_results=sandbox_results,
        auto_check_results=auto_results,
    ))

    report = validate_and_warn_evidence(report, repo_path)
    save_grading_results(conn, submission_id, report)
    logger.info('Grading complete for submission %s: total=%.1f', submission_id, report.total_score)
    return report
