import { NextRequest } from 'next/server';
import { db } from '@/db';
import { exams, revokedTokens } from '@/db/schema';
import { ok } from '@/lib/api';
import { and, eq, lt } from 'drizzle-orm';

export async function GET(_req: NextRequest) {
  const now = new Date();
  const result = await db
    .update(exams)
    .set({ status: 'closed' })
    .where(and(eq(exams.status, 'published'), lt(exams.deadline, now)))
    .returning({ id: exams.id });

  // Expired entries are useless (their JWT signature check would already
  // fail on its own) — sweep them so the table doesn't grow unbounded.
  const purged = await db
    .delete(revokedTokens)
    .where(lt(revokedTokens.expiresAt, now))
    .returning({ jti: revokedTokens.jti });

  return ok({ closed: result.length, closedIds: result.map((r) => r.id), purgedRevokedTokens: purged.length });
}
