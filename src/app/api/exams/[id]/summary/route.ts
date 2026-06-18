import { NextRequest } from 'next/server';
import { db } from '@/db';
import { exams, submissions, employees, aiGradingResults, humanReviews, levelThresholds, examAssignments } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { computeExamSummary, type SubmissionForSummary } from '@/lib/exam-summary';
import { eq, and, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);

  const [assignments, subs, thresholdRows] = await Promise.all([
    db.select().from(examAssignments).where(
      and(eq(examAssignments.examId, id), eq(examAssignments.status, 'assigned'))
    ),
    db
      .select({
        submissionId: submissions.id,
        employeeId: submissions.employeeId,
        employeeLevel: employees.level,
      })
      .from(submissions)
      .innerJoin(employees, eq(submissions.employeeId, employees.id))
      .where(eq(submissions.examId, id)),
    db.select().from(levelThresholds).where(eq(levelThresholds.examId, id)),
  ]);

  const submissionIds = subs.map((s) => s.submissionId);

  const [aiRows, reviewRows] = submissionIds.length
    ? await Promise.all([
        db.select().from(aiGradingResults).where(inArray(aiGradingResults.submissionId, submissionIds)),
        db.select().from(humanReviews).where(inArray(humanReviews.submissionId, submissionIds)),
      ])
    : [[], []];

  const aiTotalsBySubmission = new Map<string, number>();
  for (const row of aiRows) {
    aiTotalsBySubmission.set(
      row.submissionId,
      (aiTotalsBySubmission.get(row.submissionId) ?? 0) + Number(row.score),
    );
  }
  const reviewBySubmission = new Map(reviewRows.map((r) => [r.submissionId, Number(r.finalScore)]));

  const submissionsForSummary: SubmissionForSummary[] = subs.map((s) => ({
    submissionId: s.submissionId,
    employeeId: s.employeeId,
    employeeLevel: s.employeeLevel,
    aiTotalScore: aiTotalsBySubmission.has(s.submissionId) ? aiTotalsBySubmission.get(s.submissionId)! : null,
    humanFinalScore: reviewBySubmission.has(s.submissionId) ? reviewBySubmission.get(s.submissionId)! : null,
  }));

  const thresholds = thresholdRows.map((t) => ({ level: t.level, passScore: Number(t.passScore) }));

  const summary = computeExamSummary(assignments.length, submissionsForSummary, thresholds);
  return ok(summary);
}
