import { NextRequest } from 'next/server';
import { db } from '@/db';
import { submissions, employees, exams } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { eq, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const rows = await db
    .select({
      submission: submissions,
      employee: employees,
      exam: exams,
    })
    .from(submissions)
    .innerJoin(employees, eq(submissions.employeeId, employees.id))
    .innerJoin(exams, eq(submissions.examId, exams.id))
    .where(inArray(submissions.status, ['ai_graded', 'review_pending']));

  return ok(rows);
}
