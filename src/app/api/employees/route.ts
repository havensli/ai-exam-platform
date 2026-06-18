import { NextRequest } from 'next/server';
import { db } from '@/db';
import { employees } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      department: employees.department,
      level: employees.level,
    })
    .from(employees);

  return ok(rows);
}
