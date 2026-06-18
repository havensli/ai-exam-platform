import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import {
  submissions, sandboxRunResults, aiGradingResults, autoCheckResults,
  plagiarismChecks, humanReviews, employees, exams, levelThresholds,
} from '@/db/schema';
import { getSession, isTokenRevoked } from '@/lib/auth';
import { ok, err, audit } from '@/lib/api';
import { eq } from 'drizzle-orm';
import { sendWorkNotification } from '@/lib/dingtalk';

export async function GET(req: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { submissionId } = await params;
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!sub) return err('Not found', 404);

  const [employee, exam, sandbox, auto, grading, plagiarism] = await Promise.all([
    db.query.employees.findFirst({ where: eq(employees.id, sub.employeeId) }),
    db.query.exams.findFirst({ where: eq(exams.id, sub.examId) }),
    db.select().from(sandboxRunResults).where(eq(sandboxRunResults.submissionId, submissionId)),
    db.select().from(autoCheckResults).where(eq(autoCheckResults.submissionId, submissionId)),
    db.select().from(aiGradingResults).where(eq(aiGradingResults.submissionId, submissionId)),
    db.select().from(plagiarismChecks).where(eq(plagiarismChecks.submissionId, submissionId)),
  ]);

  return ok({ submission: sub, employee, exam, sandbox, auto, grading, plagiarism });
}

const reviewSchema = z.object({
  finalScore: z.number().min(0).max(100),
  adjustedItems: z.array(z.object({
    rubricItemId: z.string().uuid(),
    newScore: z.number().min(0),
    reason: z.string(),
  })).optional(),
  comment: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }
  if (await isTokenRevoked(session.jti)) return err('Unauthorized', 401);

  const { submissionId } = await params;
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!sub) return err('Not found', 404);

  const body = reviewSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const [review] = await db
    .insert(humanReviews)
    .values({
      submissionId,
      reviewerId: session.employeeId,
      finalScore: String(body.data.finalScore),
      adjustedItems: body.data.adjustedItems ?? null,
      comment: body.data.comment ?? null,
    })
    .onConflictDoNothing()
    .returning();

  await db.update(submissions).set({ status: 'completed' }).where(eq(submissions.id, submissionId));

  // Determine pass/fail and notify employee
  const employee = await db.query.employees.findFirst({ where: eq(employees.id, sub.employeeId) });
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, sub.examId) });

  if (employee && exam) {
    const [threshold] = await db
      .select()
      .from(levelThresholds)
      .where(eq(levelThresholds.examId, sub.examId))
      .limit(1);

    const passed = threshold ? body.data.finalScore >= Number(threshold.passScore) : false;
    void sendWorkNotification(
      [employee.dingtalkUserid],
      `${exam.title} — 成绩公布`,
      `你的最终得分：${body.data.finalScore} 分，${passed ? '✅ 通过' : '❌ 未通过'}。`,
      exam.id,
      [employee.id],
    ).catch(console.error);
  }

  await audit(session.employeeId, 'review.complete', 'submission', submissionId, {
    finalScore: body.data.finalScore,
  });
  return ok(review);
}
