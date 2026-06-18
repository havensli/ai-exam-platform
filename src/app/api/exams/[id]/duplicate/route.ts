import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { db } from '@/db';
import { exams, rubricItems, levelThresholds } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err, audit } from '@/lib/api';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const original = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!original) return err('Not found', 404);

  const items = await db.select().from(rubricItems).where(eq(rubricItems.examId, id));
  const thresholds = await db.select().from(levelThresholds).where(eq(levelThresholds.examId, id));

  // Deliberately not copied: exam_assignments / prompt_versions / submissions —
  // anything tied to a specific "already published" run of the original exam.
  const newExamId = randomUUID();

  const examInsert = db
    .insert(exams)
    .values({
      id: newExamId,
      title: `${original.title}（副本）`,
      background: original.background,
      runCommand: original.runCommand,
      installCommand: original.installCommand,
      status: 'draft',
      deadline: original.deadline,
      createdBy: session.employeeId,
    })
    .returning();

  const batchQueries: Array<Parameters<typeof db.batch>[0][number]> = [examInsert];
  if (items.length) {
    batchQueries.push(
      db.insert(rubricItems).values(
        items.map((item) => ({
          examId: newExamId,
          name: item.name,
          weight: item.weight,
          criteriaText: item.criteriaText,
          isCore: item.isCore,
          hiddenNotes: item.hiddenNotes,
          orderIndex: item.orderIndex,
        }))
      )
    );
  }
  if (thresholds.length) {
    batchQueries.push(
      db.insert(levelThresholds).values(
        thresholds.map((t) => ({
          examId: newExamId,
          level: t.level,
          passScore: t.passScore,
        }))
      )
    );
  }

  const results = await db.batch(
    batchQueries as [Parameters<typeof db.batch>[0][number], ...Parameters<typeof db.batch>[0][number][]]
  );
  const [newExam] = results[0] as [typeof original];

  await audit(session.employeeId, 'exam.duplicate', 'exam', newExam.id, { copiedFrom: id });
  return ok(newExam, 201);
}
