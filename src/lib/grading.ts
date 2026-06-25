import { db } from '@/db';
import { submissions, gradingTasks } from '@/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';

export const RETRIGGERABLE_STATUSES = ['pending', 'processing', 'sandbox_done'] as const;

export async function requeueSubmissions(submissionIds: string[]): Promise<number> {
  if (submissionIds.length === 0) return 0;

  const taskRows = await db
    .select()
    .from(gradingTasks)
    .where(inArray(gradingTasks.submissionId, submissionIds))
    .orderBy(desc(gradingTasks.createdAt));

  const latestTaskIdBySubmission = new Map<string, string>();
  for (const t of taskRows) {
    if (!latestTaskIdBySubmission.has(t.submissionId)) {
      latestTaskIdBySubmission.set(t.submissionId, t.id);
    }
  }

  for (const id of submissionIds) {
    const taskId = latestTaskIdBySubmission.get(id);
    if (taskId) {
      await db
        .update(gradingTasks)
        .set({ status: 'pending', retryCount: 0, error: null, updatedAt: new Date() })
        .where(eq(gradingTasks.id, taskId));
    } else {
      await db.insert(gradingTasks).values({ submissionId: id });
    }
    await db.update(submissions).set({ status: 'pending' }).where(eq(submissions.id, id));
  }

  return submissionIds.length;
}
