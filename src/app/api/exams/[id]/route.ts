import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { exams, rubricItems, levelThresholds } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err, audit, sumRubricWeights } from '@/lib/api';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return err('Unauthorized', 401);

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);

  const isPrivileged = ['system_admin', 'exam_creator', 'reviewer'].includes(session.role);
  const items = await db.select().from(rubricItems).where(eq(rubricItems.examId, id));
  const thresholds = await db.select().from(levelThresholds).where(eq(levelThresholds.examId, id));

  const sanitizedItems = isPrivileged
    ? items
    : items.map(({ hiddenNotes: _h, ...rest }) => rest);

  return ok({ ...exam, rubricItems: sanitizedItems, levelThresholds: thresholds });
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  background: z.string().optional(),
  runCommand: z.string().optional(),
  installCommand: z.string().optional(),
  deadline: z.string().datetime().optional(),
  rubricItems: z.array(z.object({
    name: z.string().min(1),
    weight: z.number().int().min(1),
    criteriaText: z.string().min(1),
    isCore: z.boolean().default(false),
    hiddenNotes: z.string().optional(),
    orderIndex: z.number().int().optional(),
  })).min(1).optional(),
  thresholds: z.array(z.object({
    level: z.enum(['junior', 'mid', 'senior', 'staff']),
    passScore: z.number().min(0).max(100),
  })).optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);
  if (exam.status !== 'draft') return err('Only draft exams can be edited', 400);

  const body = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const { deadline: deadlineStr, rubricItems: items, thresholds, ...restData } = body.data;

  if (items) {
    const weightSum = sumRubricWeights(items);
    if (weightSum !== 100) {
      return err(`考点权重合计为 ${weightSum}，必须等于 100`, 400);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setPayload: any = { ...restData };
  if (deadlineStr) setPayload.deadline = new Date(deadlineStr);

  const [updated] = await db.update(exams).set(setPayload).where(eq(exams.id, id)).returning();

  if (items) {
    await db.delete(rubricItems).where(eq(rubricItems.examId, id));
    await db.insert(rubricItems).values(
      items.map((item, i) => ({ ...item, examId: id, orderIndex: item.orderIndex ?? i }))
    );
  }

  if (thresholds) {
    await db.delete(levelThresholds).where(eq(levelThresholds.examId, id));
    if (thresholds.length) {
      await db.insert(levelThresholds).values(
        thresholds.map((t) => ({ examId: id, level: t.level, passScore: String(t.passScore) }))
      );
    }
  }

  await audit(session.employeeId, 'exam.update', 'exam', id, { before: exam, after: updated });
  return ok(updated);
}
