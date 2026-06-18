-- grading_tasks: queue between main system and Worker
CREATE TABLE grading_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID NOT NULL REFERENCES submissions(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','completed','failed')),
    retry_count     INT  NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grading_tasks_pending
    ON grading_tasks (created_at)
    WHERE status = 'pending';

-- sandbox_run_results: per-phase output from executor.py
CREATE TABLE sandbox_run_results (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id    UUID NOT NULL REFERENCES submissions(id),
    phase            TEXT NOT NULL CHECK (phase IN ('clone','install','run')),
    returncode       INT  NOT NULL,
    stdout           TEXT,
    stderr           TEXT,
    duration_seconds NUMERIC(8,2),
    timed_out        BOOLEAN NOT NULL DEFAULT FALSE,
    oom_killed       BOOLEAN NOT NULL DEFAULT FALSE,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, phase)
);

-- submissions: employee submissions (reference, full DDL in main migration)
-- Adding git_token_encrypted column if table already exists:
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS
    git_token_encrypted TEXT;  -- AES-256 encrypted, decrypted only at clone time

-- Status values for submissions
-- 'pending'        submitted, waiting for grading
-- 'processing'     worker has claimed the task
-- 'sandbox_done'   sandbox phases complete, LLM grading next
-- 'ai_graded'      LLM evaluation complete
-- 'review_pending' awaiting human reviewer
-- 'completed'      human review done, final score set
