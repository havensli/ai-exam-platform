import { NextRequest } from 'next/server';
import { db } from '@/db';
import { submissions } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err, audit } from '@/lib/api';
import { RETRIGGERABLE_STATUSES, requeueSubmissions } from '@/lib/grading';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, id) });
  if (!sub) return err('Not found', 404);

  if (!RETRIGGERABLE_STATUSES.includes(sub.status as typeof RETRIGGERABLE_STATUSES[number])) {
    return err('该提交已有 AI 评分或复核结果，不能重新触发阅卷', 400);
  }

  await requeueSubmissions([id]);

  await audit(session.employeeId, 'submission.regrade', 'submission', id);
  return ok({ requeued: true });
}
