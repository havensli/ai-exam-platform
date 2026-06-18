"""
Main worker — full pipeline:
  pending → [clone] → [install] → [run] → sandbox_done
         → [first_layer_check + llm_grading] → ai_graded
"""
from __future__ import annotations

import logging
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

# Ensure grading package is importable
sys.path.insert(0, str(Path(__file__).parent))

from grading.crypto import decrypt_token
from grading.grader import grade_submission
from sandbox.executor import SandboxExecutor

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ['DATABASE_URL']
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '10'))
MAX_RETRIES = int(os.getenv('MAX_RETRIES', '3'))
WORK_BASE_DIR = os.getenv('WORK_BASE_DIR', '/tmp/sandbox_workdir')
SANDBOX_IMAGE = os.getenv('SANDBOX_IMAGE', 'python:3.12-slim')


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def claim_next_task(conn) -> Optional[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE grading_tasks
            SET status = 'processing', updated_at = NOW()
            WHERE id = (
                SELECT id FROM grading_tasks
                WHERE status = 'pending' AND retry_count < %s
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, submission_id
        """, (MAX_RETRIES,))
        conn.commit()
        return cur.fetchone()


def fetch_submission(conn, submission_id: str) -> Optional[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT s.id, s.repo_url, s.deploy_url, s.git_token_encrypted,
                   e.run_command, e.install_command, e.id as exam_id
            FROM submissions s JOIN exams e ON e.id = s.exam_id
            WHERE s.id = %s
        """, (submission_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def mark_task(conn, task_id: str, success: bool, error: Optional[str] = None) -> None:
    status = 'completed' if success else 'failed'
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE grading_tasks
            SET status = %s, error = %s, updated_at = NOW(),
                retry_count = CASE WHEN %s THEN retry_count ELSE retry_count + 1 END
            WHERE id = %s
        """, (status, error, success, task_id))
    conn.commit()


def process_task(conn, task: dict, executor: SandboxExecutor) -> None:
    submission_id = str(task['submission_id'])
    task_id = str(task['id'])
    logger.info('Processing task %s submission %s', task_id, submission_id)

    sub = fetch_submission(conn, submission_id)
    if not sub:
        mark_task(conn, task_id, False, 'Submission not found')
        return

    work_dir = Path(WORK_BASE_DIR) / submission_id
    work_dir.mkdir(parents=True, exist_ok=True)
    repo_path = str(work_dir / 'repo')

    try:
        _raw_token = sub.get('git_token_encrypted')
        git_token: Optional[str] = decrypt_token(_raw_token) if _raw_token else None

        results = executor.run(
            submission_id=submission_id,
            repo_url=sub['repo_url'],
            run_command=sub['run_command'],
            git_token=git_token,
            install_command=sub.get('install_command'),
        )

        # Persist sandbox results
        with conn.cursor() as cur:
            for r in results:
                cur.execute("""
                    INSERT INTO sandbox_run_results
                        (submission_id, phase, returncode, stdout, stderr,
                         duration_seconds, timed_out, oom_killed, error)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (submission_id, phase) DO UPDATE SET
                        returncode = EXCLUDED.returncode, stdout = EXCLUDED.stdout,
                        stderr = EXCLUDED.stderr, timed_out = EXCLUDED.timed_out,
                        oom_killed = EXCLUDED.oom_killed, error = EXCLUDED.error
                """, (submission_id, r.phase, r.returncode, r.stdout, r.stderr,
                      r.duration_seconds, r.timed_out, r.oom_killed, r.error))
        conn.commit()

        run_result = next((r for r in results if r.phase == 'run'), None)
        sandbox_ok = run_result is not None  # grading proceeds even if tests fail

        if sandbox_ok:
            with conn.cursor() as cur:
                cur.execute("UPDATE submissions SET status = 'sandbox_done' WHERE id = %s", (submission_id,))
            conn.commit()

            # LLM grading (includes first-layer checks)
            grade_submission(conn, submission_id, repo_path)
            mark_task(conn, task_id, True)
        else:
            errors = '; '.join(f'{r.phase}: {r.error or "exit " + str(r.returncode)}' for r in results if not r.succeeded)
            mark_task(conn, task_id, False, errors)

    except Exception as exc:
        logger.exception('Task %s failed', task_id)
        mark_task(conn, task_id, False, str(exc))
    finally:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


def main() -> None:
    executor = SandboxExecutor(docker_image=SANDBOX_IMAGE, work_base_dir=WORK_BASE_DIR)
    logger.info('Worker started, polling every %ds', POLL_INTERVAL)

    while True:
        try:
            conn = get_conn()
            task = claim_next_task(conn)
            if task:
                process_task(conn, task, executor)
            else:
                time.sleep(POLL_INTERVAL)
            conn.close()
        except psycopg2.OperationalError:
            logger.warning('DB connection lost, retry in 30s')
            time.sleep(30)
        except KeyboardInterrupt:
            logger.info('Worker shutting down')
            break


if __name__ == '__main__':
    main()
