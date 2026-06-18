import { NextRequest } from 'next/server';
import { db } from '@/db';
import { employees, examAssignments, submissions, exams } from '@/db/schema';
import { ok, audit } from '@/lib/api';
import { eq, and, inArray } from 'drizzle-orm';

export async function GET(_req: NextRequest) {
  const inactiveEmployees = await db
    .select()
    .from(employees)
    .where(inArray(employees.status, ['disabled', 'left']));
  const inactiveIds = inactiveEmployees.map((e) => e.id);

  if (inactiveIds.length === 0) {
    return ok({ voidedAssignments: 0, flaggedExams: 0 });
  }

  // Void assigned-but-not-submitted assignments for inactive employees so
  // they stop counting as "pending" and stop being reminded.
  const assignmentsToCheck = await db
    .select()
    .from(examAssignments)
    .where(and(inArray(examAssignments.employeeId, inactiveIds), eq(examAssignments.status, 'assigned')));

  let voidedAssignments = 0;
  for (const assignment of assignmentsToCheck) {
    const existingSubmission = await db.query.submissions.findFirst({
      where: and(eq(submissions.examId, assignment.examId), eq(submissions.employeeId, assignment.employeeId)),
    });
    if (!existingSubmission) {
      await db.update(examAssignments).set({ status: 'voided' }).where(eq(examAssignments.id, assignment.id));
      voidedAssignments += 1;
    }
  }

  // Flag draft exams whose creator has left, so an admin can pick a new owner.
  const orphanedExams = await db
    .select()
    .from(exams)
    .where(and(
      inArray(exams.createdBy, inactiveIds),
      eq(exams.status, 'draft'),
      eq(exams.needsOwnerTransfer, false),
    ));

  for (const exam of orphanedExams) {
    await db.update(exams).set({ needsOwnerTransfer: true }).where(eq(exams.id, exam.id));
    await audit(null, 'exam.owner_left', 'exam', exam.id);
  }

  return ok({ voidedAssignments, flaggedExams: orphanedExams.length });
}
