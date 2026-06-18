import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { exams, employees, notificationLogs } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { resendToEmployee } from '@/lib/dingtalk';
import { eq, and, desc, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;

  // One row per employee: their most recent notification log for this exam.
  const rows = await db
    .select({
      logId: notificationLogs.id,
      employeeId: notificationLogs.employeeId,
      name: employees.name,
      status: notificationLogs.status,
      sentAt: notificationLogs.sentAt,
    })
    .from(notificationLogs)
    .innerJoin(employees, eq(notificationLogs.employeeId, employees.id))
    .where(eq(notificationLogs.examId, id))
    .orderBy(desc(notificationLogs.sentAt));

  const latestByEmployee = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestByEmployee.has(row.employeeId)) latestByEmployee.set(row.employeeId, row);
  }

  const failed = [...latestByEmployee.values()].filter((r) => r.status === 'failed');
  return ok(failed);
}

const resendSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);

  const body = resendSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const targets = await db
    .select()
    .from(employees)
    .where(inArray(employees.id, body.data.employeeIds));

  const title = `新考试发布：${exam.title}`;
  const content = `截止时间：${exam.deadline.toLocaleDateString('zh-CN')}，请尽快完成提交。`;

  const results: { employeeId: string; success: boolean }[] = [];
  for (const emp of targets) {
    const success = await resendToEmployee(emp.dingtalkUserid, title, content);
    results.push({ employeeId: emp.id, success });

    const [existingLog] = await db
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.employeeId, emp.id), eq(notificationLogs.examId, id)))
      .orderBy(desc(notificationLogs.sentAt))
      .limit(1);

    if (existingLog) {
      await db
        .update(notificationLogs)
        .set({ status: success ? 'sent' : 'failed', sentAt: new Date() })
        .where(eq(notificationLogs.id, existingLog.id));
    } else {
      await db.insert(notificationLogs).values({
        employeeId: emp.id,
        type: 'published',
        examId: id,
        status: success ? 'sent' : 'failed',
      });
    }
  }

  return ok(results);
}
