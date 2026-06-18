import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { appeals, humanReviews } from '@/db/schema';
import { getSession, isTokenRevoked } from '@/lib/auth';
import { ok, err, audit } from '@/lib/api';
import { eq } from 'drizzle-orm';

const schema = z.object({
  secondReviewScore: z.number().min(0).max(100),
  secondReviewComment: z.string().min(1),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }
  if (await isTokenRevoked(session.jti)) return err('Unauthorized', 401);

  const { id } = await params;
  const appeal = await db.query.appeals.findFirst({ where: eq(appeals.id, id) });
  if (!appeal) return err('Appeal not found', 404);
  if (appeal.status === 'closed') return err('Appeal already closed', 400);

  // Prevent the original reviewer from handling the second review
  const originalReview = await db.query.humanReviews.findFirst({
    where: eq(humanReviews.submissionId, appeal.submissionId),
  });
  if (originalReview?.reviewerId === session.employeeId) {
    return err('The original reviewer cannot handle the second review', 403);
  }

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const [updated] = await db
    .update(appeals)
    .set({
      status: 'closed',
      secondReviewerId: session.employeeId,
      secondReviewScore: String(body.data.secondReviewScore),
      secondReviewComment: body.data.secondReviewComment,
      resolvedAt: new Date(),
    })
    .where(eq(appeals.id, id))
    .returning();

  await audit(session.employeeId, 'appeal.resolve', 'appeal', id, {
    score: body.data.secondReviewScore,
  });
  return ok(updated);
}
