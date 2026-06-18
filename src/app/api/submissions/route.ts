import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { exams, submissions, submissionHistory, gradingTasks } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { encryptToken } from '@/lib/crypto';
import { eq, and } from 'drizzle-orm';

const schema = z.object({
  examId: z.string().uuid(),
  deployUrl: z.string().url(),
  repoUrl: z.string().url(),
  assumptionText: z.string().optional(),
  assumptionDocUrl: z.string().url().optional(),
  gitToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return err('Unauthorized', 401);

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const exam = await db.query.exams.findFirst({ where: eq(exams.id, body.data.examId) });
  if (!exam) return err('Exam not found', 404);
  if (exam.status !== 'published') return err('Exam is not open for submissions', 400);
  if (new Date() > exam.deadline) return err('Submission deadline has passed', 400);

  // Check for existing submission to determine version
  const existing = await db.query.submissions.findFirst({
    where: and(
      eq(submissions.examId, body.data.examId),
      eq(submissions.employeeId, session.employeeId),
    ),
  });

  const newVersion = (existing?.version ?? 0) + 1;
  const gitTokenEncrypted = body.data.gitToken ? encryptToken(body.data.gitToken) : null;

  let sub: typeof existing;
  if (existing) {
    const [updated] = await db
      .update(submissions)
      .set({
        deployUrl: body.data.deployUrl,
        repoUrl: body.data.repoUrl,
        assumptionText: body.data.assumptionText ?? null,
        assumptionDocUrl: body.data.assumptionDocUrl ?? null,
        status: 'pending',
        version: newVersion,
        submittedAt: new Date(),
        gitTokenEncrypted,
      })
      .where(eq(submissions.id, existing.id))
      .returning();
    sub = updated;
  } else {
    const [inserted] = await db
      .insert(submissions)
      .values({
        examId: body.data.examId,
        employeeId: session.employeeId,
        deployUrl: body.data.deployUrl,
        repoUrl: body.data.repoUrl,
        assumptionText: body.data.assumptionText ?? null,
        assumptionDocUrl: body.data.assumptionDocUrl ?? null,
        status: 'pending',
        version: 1,
        gitTokenEncrypted,
      })
      .returning();
    sub = inserted;
  }

  // Snapshot for history — never persist the plaintext token
  const { gitToken: _gitToken, ...snapshotData } = body.data;
  await db.insert(submissionHistory).values({
    submissionId: sub!.id,
    version: newVersion,
    snapshot: { ...snapshotData, submittedAt: new Date().toISOString() },
  });

  // Enqueue grading task
  await db.insert(gradingTasks).values({ submissionId: sub!.id }).onConflictDoNothing();

  return ok(sub, existing ? 200 : 201);
}
