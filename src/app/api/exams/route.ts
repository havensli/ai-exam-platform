import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { exams, rubricItems, levelThresholds, examAssignments } from '@/db/schema';
import { getSession, isTokenRevoked } from '@/lib/auth';
import { ok, err, audit, sumRubricWeights } from '@/lib/api';
import { eq, desc, inArray } from 'drizzle-orm';

const rubricItemSchema = z.object({
  name: z.string().min(1),
  weight: z.number().int().min(1),
  criteriaText: z.string().min(1),
  isCore: z.boolean().default(false),
  hiddenNotes: z.string().optional(),
  orderIndex: z.number().int().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  background: z.string().min(1),
  runCommand: z.string().min(1),
  installCommand: z.string().optional(),
  deadline: z.string().datetime(),
  rubricItems: z.array(rubricItemSchema).min(1),
  thresholds: z.array(z.object({
    level: z.enum(['junior', 'mid', 'senior', 'staff']),
    passScore: z.number().min(0).max(100),
  })).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return err('Unauthorized', 401);

  const isAdmin = ['system_admin', 'exam_creator', 'reviewer'].includes(session.role);

  if (isAdmin) {
    const rows = await db.select().from(exams).orderBy(desc(exams.createdAt));
    return ok(rows);
  }

  // Employee: only return exams they have been assigned to
  const assignments = await db
    .select({ examId: examAssignments.examId })
    .from(examAssignments)
    .where(eq(examAssignments.employeeId, session.employeeId));

  const assignedExamIds = assignments.map((a) => a.examId);

  if (assignedExamIds.length === 0) {
    return ok([]);
  }

  const rows = await db
    .select()
    .from(exams)
    .where(inArray(exams.id, assignedExamIds))
    .orderBy(desc(exams.createdAt));

  return ok(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }
  if (await isTokenRevoked(session.jti)) return err('Unauthorized', 401);

  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const { thresholds, rubricItems: items, ...examData } = body.data;

  const weightSum = sumRubricWeights(items);
  if (weightSum !== 100) {
    return err(`考点权重合计为 ${weightSum}，必须等于 100`, 400);
  }

  // Generate the id client-side so the rubric/threshold inserts can reference
  // it without a round trip — required to bundle all three inserts into one
  // atomic db.batch() call (the neon-http driver has no db.transaction()).
  const examId = randomUUID();

  const examInsert = db
    .insert(exams)
    .values({
      id: examId,
      ...examData,
      deadline: new Date(examData.deadline),
      createdBy: session.employeeId,
    })
    .returning();

  const rubricInsert = db.insert(rubricItems).values(
    items.map((item, i) => ({ ...item, examId, orderIndex: item.orderIndex ?? i }))
  );

  const results = thresholds?.length
    ? await db.batch([
        examInsert,
        rubricInsert,
        db.insert(levelThresholds).values(
          thresholds.map((t) => ({ examId, level: t.level, passScore: String(t.passScore) }))
        ),
      ])
    : await db.batch([examInsert, rubricInsert]);

  const [exam] = results[0];

  await audit(session.employeeId, 'exam.create', 'exam', exam.id);
  return ok(exam, 201);
}
