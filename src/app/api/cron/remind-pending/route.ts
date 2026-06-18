import { NextRequest } from 'next/server';
import { db } from '@/db';
import { exams, submissions, employees, examAssignments } from '@/db/schema';
import { ok } from '@/lib/api';
import { sendWorkNotification } from '@/lib/dingtalk';
import { eq, and, lt, gt, inArray } from 'drizzle-orm';

export async function GET(_req: NextRequest) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find published exams with deadline within the next 24 hours
  const closingExams = await db
    .select()
    .from(exams)
    .where(
      and(eq(exams.status, 'published'), gt(exams.deadline, now), lt(exams.deadline, in24h))
    );

  let reminders = 0;
  for (const exam of closingExams) {
    // Find employees assigned to this exam via exam_assignments
    const assigned = await db
      .select({ employeeId: examAssignments.employeeId })
      .from(examAssignments)
      .where(and(eq(examAssignments.examId, exam.id), eq(examAssignments.status, 'assigned')));

    const assignedIds = assigned.map((a) => a.employeeId);
    if (assignedIds.length === 0) continue;

    // Find employees who have already submitted
    const submitted = await db
      .select({ employeeId: submissions.employeeId })
      .from(submissions)
      .where(and(eq(submissions.examId, exam.id), inArray(submissions.employeeId, assignedIds)));

    const submittedIds = new Set(submitted.map((s) => s.employeeId));

    // Pending = assigned but not submitted
    const pendingIds = assignedIds.filter((id) => !submittedIds.has(id));
    if (pendingIds.length === 0) continue;

    const pendingEmployees = await db
      .select()
      .from(employees)
      .where(inArray(employees.id, pendingIds));

    if (pendingEmployees.length === 0) continue;

    await sendWorkNotification(
      pendingEmployees.map((e) => e.dingtalkUserid),
      `截止提醒：${exam.title}`,
      `考试将于 ${exam.deadline.toLocaleString('zh-CN')} 截止，请尽快提交。`,
      exam.id,
      pendingEmployees.map((e) => e.id),
    );
    reminders += pendingEmployees.length;
  }

  return ok({ reminders, examsChecked: closingExams.length });
}
