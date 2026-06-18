import { NextRequest } from 'next/server';
import { db } from '@/db';
import { submissions, exams, humanReviews, levelThresholds, employees } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { eq, desc, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return err('Unauthorized', 401);

  const employee = await db.query.employees.findFirst({ where: eq(employees.id, session.employeeId) });

  const subs = await db
    .select({
      submissionId: submissions.id,
      examId: submissions.examId,
      examTitle: exams.title,
      status: submissions.status,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(exams, eq(submissions.examId, exams.id))
    .where(eq(submissions.employeeId, session.employeeId))
    .orderBy(desc(submissions.submittedAt));

  const submissionIds = subs.map((s) => s.submissionId);
  const reviews = submissionIds.length
    ? await db.select().from(humanReviews).where(inArray(humanReviews.submissionId, submissionIds))
    : [];
  const reviewBySubmission = new Map(reviews.map((r) => [r.submissionId, r]));

  const examIds = [...new Set(subs.map((s) => s.examId))];
  const thresholdRows = examIds.length
    ? await db.select().from(levelThresholds).where(inArray(levelThresholds.examId, examIds))
    : [];
  const passScoreByExamLevel = new Map(
    thresholdRows.map((t) => [`${t.examId}:${t.level}`, Number(t.passScore)])
  );

  const result = subs.map((s) => {
    const review = reviewBySubmission.get(s.submissionId);
    const finalScore = review ? Number(review.finalScore) : null;
    const passScore = employee ? passScoreByExamLevel.get(`${s.examId}:${employee.level}`) : undefined;
    const passed = finalScore !== null && passScore !== undefined ? finalScore >= passScore : null;
    return {
      submissionId: s.submissionId,
      examTitle: s.examTitle,
      status: s.status,
      submittedAt: s.submittedAt,
      finalScore,
      passed,
    };
  });

  return ok(result);
}
