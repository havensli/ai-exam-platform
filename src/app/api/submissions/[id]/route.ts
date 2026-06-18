import { NextRequest } from 'next/server';
import { db } from '@/db';
import { submissions, sandboxRunResults, aiGradingResults, autoCheckResults } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return err('Unauthorized', 401);

  const { id } = await params;
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, id) });
  if (!sub) return err('Not found', 404);

  const isPrivileged = ['system_admin', 'exam_creator', 'reviewer'].includes(session.role);
  if (!isPrivileged && sub.employeeId !== session.employeeId) {
    return err('Forbidden', 403);
  }

  const sandboxResults = await db.select().from(sandboxRunResults).where(eq(sandboxRunResults.submissionId, id));
  const autoChecks = await db.select().from(autoCheckResults).where(eq(autoCheckResults.submissionId, id));

  // Only show AI/final scores once grading is complete
  const showScores = isPrivileged || sub.status === 'completed';
  const gradingRows = showScores
    ? await db.select().from(aiGradingResults).where(eq(aiGradingResults.submissionId, id))
    : [];

  // Strip sensitive fields for non-privileged
  const { gitTokenEncrypted: _t, ...safeSub } = sub;

  return ok({
    ...safeSub,
    sandboxResults,
    autoChecks,
    aiGradingResults: gradingRows,
  });
}
