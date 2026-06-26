import { NextRequest } from 'next/server';
import { db } from '@/db';
import { submissions, employees, exams, gradingTasks } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { RETRIGGERABLE_STATUSES } from '@/lib/grading';
import { inArray, desc, eq } from 'drizzle-orm';

const GRADING_PIPELINE_STATUSES = [...RETRIGGERABLE_STATUSES, 'ai_graded'] as const;

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const subs = await db
    .select({
      submissionId: submissions.id,
      submittedAt: submissions.submittedAt,
      status: submissions.status,
      examId: exams.id,
      examTitle: exams.title,
      employeeName: employees.name,
      employeeLevel: employees.level,
    })
    .from(submissions)
    .innerJoin(exams, eq(submissions.examId, exams.id))
    .innerJoin(employees, eq(submissions.employeeId, employees.id))
    .where(inArray(submissions.status, [...GRADING_PIPELINE_STATUSES]))
    .orderBy(desc(submissions.submittedAt));

  const submissionIds = subs.map((s) => s.submissionId);
  const taskRows = submissionIds.length
    ? await db
        .select()
        .from(gradingTasks)
        .where(inArray(gradingTasks.submissionId, submissionIds))
        .orderBy(desc(gradingTasks.createdAt))
    : [];

  const latestTaskBySubmission = new Map<string, { status: string; error: string | null; retryCount: number }>();
  for (const t of taskRows) {
    if (!latestTaskBySubmission.has(t.submissionId)) {
      latestTaskBySubmission.set(t.submissionId, { status: t.status, error: t.error, retryCount: t.retryCount });
    }
  }

  const result = subs.map((s) => ({
    ...s,
    taskStatus: latestTaskBySubmission.get(s.submissionId)?.status ?? null,
    taskError: latestTaskBySubmission.get(s.submissionId)?.error ?? null,
    taskRetryCount: latestTaskBySubmission.get(s.submissionId)?.retryCount ?? 0,
  }));

  return ok(result);
}
