import { NextRequest } from 'next/server';
import { db } from '@/db';
import { submissions } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err, audit } from '@/lib/api';
import { RETRIGGERABLE_STATUSES, requeueSubmissions } from '@/lib/grading';
import { inArray } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const eligible = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(inArray(submissions.status, [...RETRIGGERABLE_STATUSES]));

  const count = await requeueSubmissions(eligible.map((s) => s.id));

  await audit(session.employeeId, 'submission.regrade_bulk', 'submission', 'all', { count });
  return ok({ requeued: count });
}
