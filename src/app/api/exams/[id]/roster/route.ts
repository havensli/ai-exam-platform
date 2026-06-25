import { NextRequest } from 'next/server';
import { db } from '@/db';
import {
  exams, examAssignments, submissions, employees,
  aiGradingResults, humanReviews, gradingTasks,
} from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { eq, inArray, desc } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);

  const [assignments, subs] = await Promise.all([
    db
      .select({ employeeId: examAssignments.employeeId, name: employees.name, level: employees.level })
      .from(examAssignments)
      .innerJoin(employees, eq(examAssignments.employeeId, employees.id))
      .where(eq(examAssignments.examId, id)),
    db
      .select({
        submissionId: submissions.id,
        employeeId: submissions.employeeId,
        name: employees.name,
        level: employees.level,
        status: submissions.status,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .innerJoin(employees, eq(submissions.employeeId, employees.id))
      .where(eq(submissions.examId, id)),
  ]);

  const submissionIds = subs.map((s) => s.submissionId);

  const [aiRows, reviewRows, taskRows] = submissionIds.length
    ? await Promise.all([
        db.select().from(aiGradingResults).where(inArray(aiGradingResults.submissionId, submissionIds)),
        db.select().from(humanReviews).where(inArray(humanReviews.submissionId, submissionIds)),
        db.select().from(gradingTasks).where(inArray(gradingTasks.submissionId, submissionIds)).orderBy(desc(gradingTasks.createdAt)),
      ])
    : [[], [], []];

  const aiTotalsBySubmission = new Map<string, number>();
  for (const row of aiRows) {
    aiTotalsBySubmission.set(row.submissionId, (aiTotalsBySubmission.get(row.submissionId) ?? 0) + Number(row.score));
  }
  const reviewBySubmission = new Map(reviewRows.map((r) => [r.submissionId, Number(r.finalScore)]));
  // taskRows ordered newest-first — first match per submission wins
  const latestTaskBySubmission = new Map<string, { status: string; error: string | null }>();
  for (const t of taskRows) {
    if (!latestTaskBySubmission.has(t.submissionId)) {
      latestTaskBySubmission.set(t.submissionId, { status: t.status, error: t.error });
    }
  }

  const bySubmittedEmployee = new Map(subs.map((s) => [s.employeeId, s]));

  const roster = [
    ...subs.map((s) => ({
      employeeId: s.employeeId,
      name: s.name,
      level: s.level,
      submissionId: s.submissionId,
      submittedAt: s.submittedAt,
      status: s.status,
      taskStatus: latestTaskBySubmission.get(s.submissionId)?.status ?? null,
      taskError: latestTaskBySubmission.get(s.submissionId)?.error ?? null,
      aiScore: aiTotalsBySubmission.get(s.submissionId) ?? null,
      finalScore: reviewBySubmission.get(s.submissionId) ?? null,
    })),
    ...assignments
      .filter((a) => !bySubmittedEmployee.has(a.employeeId))
      .map((a) => ({
        employeeId: a.employeeId,
        name: a.name,
        level: a.level,
        submissionId: null,
        submittedAt: null,
        status: 'not_submitted' as const,
        taskStatus: null,
        taskError: null,
        aiScore: null,
        finalScore: null,
      })),
  ];

  return ok(roster);
}
