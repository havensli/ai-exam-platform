import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { appeals, submissions } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { eq, and } from 'drizzle-orm';

const schema = z.object({
  submissionId: z.string().uuid(),
  reason: z.string().min(10),
});

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return err('Unauthorized', 401);

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const sub = await db.query.submissions.findFirst({
    where: eq(submissions.id, body.data.submissionId),
  });
  if (!sub) return err('Submission not found', 404);
  if (sub.employeeId !== session.employeeId) return err('Forbidden', 403);
  if (sub.status !== 'completed') return err('Can only appeal completed submissions', 400);

  const existing = await db.query.appeals.findFirst({
    where: and(
      eq(appeals.submissionId, body.data.submissionId),
      eq(appeals.appellantId, session.employeeId),
    ),
  });
  if (existing) return err('You have already submitted an appeal for this submission', 409);

  const [appeal] = await db
    .insert(appeals)
    .values({
      submissionId: body.data.submissionId,
      appellantId: session.employeeId,
      reason: body.data.reason,
    })
    .returning();

  return ok(appeal, 201);
}
