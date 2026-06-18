import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { exams, rubricItems } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err, sumRubricWeights } from '@/lib/api';
import { eq } from 'drizzle-orm';

const schema = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    weight: z.number().int().min(1),
    criteriaText: z.string().min(1),
    isCore: z.boolean().default(false),
    hiddenNotes: z.string().optional(),
    orderIndex: z.number().int().default(0),
  })).min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);
  if (exam.status !== 'draft') return err('Cannot modify rubric of a published exam', 400);

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const weightSum = sumRubricWeights(body.data.items);
  if (weightSum !== 100) {
    return err(`考点权重合计为 ${weightSum}，必须等于 100`, 400);
  }

  await db.delete(rubricItems).where(eq(rubricItems.examId, id));
  const inserted = await db
    .insert(rubricItems)
    .values(body.data.items.map((item) => ({ ...item, examId: id })))
    .returning();

  return ok(inserted, 201);
}
