import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { exams, employees, userRoles, promptVersions, rubricItems, examAssignments } from '@/db/schema';
import { getSession, isTokenRevoked } from '@/lib/auth';
import { ok, err, audit } from '@/lib/api';
import { sendWorkNotification } from '@/lib/dingtalk';
import { eq, inArray } from 'drizzle-orm';

const publishSchema = z.object({
  targetEmployeeIds: z.array(z.string().uuid()).optional(),
  targetLevels: z.array(z.enum(['junior', 'mid', 'senior', 'staff'])).optional(),
});

const DEFAULT_PROMPT_TEMPLATE = `
你是一名技术考试阅卷专家。请根据以下考试信息和评分标准，对候选人提交的代码仓库进行逐项评分。

## 考试信息
标题：{{exam_title}}
背景：{{exam_background}}

## 评分标准（考点列表）
{{rubric_items}}

## 留白规则说明（仅供阅卷参考）
{{hidden_notes}}

## 客观检测结果
沙箱执行结果：{{sandbox_summary}}
自动化检测结果：{{auto_check_summary}}

## 评分要求
1. 逐项对每个考点进行评分，分数不超过该考点权重
2. 给出评分理由（200字以内），并引用代码证据（文件路径+行号+代码片段）
3. 对留白规则，评估候选人是否给出了合理假设
4. 置信度低时在 grading_warnings 中注明
5. 不猜测代码意图，只基于可见代码和测试结果评分
`.trim();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator'].includes(session.role)) {
    return err('Forbidden', 403);
  }
  if (await isTokenRevoked(session.jti)) return err('Unauthorized', 401);

  const { id } = await params;
  const body = publishSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);
  const { targetEmployeeIds, targetLevels } = body.data;

  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);
  if (exam.status !== 'draft') return err('Exam is already published or closed', 400);

  const items = await db.select().from(rubricItems).where(eq(rubricItems.examId, id));
  if (items.length === 0) return err('Cannot publish exam without rubric items', 400);

  const [existing] = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.examId, id))
    .limit(1);

  const version = (existing?.version ?? 0) + 1;
  await db.insert(promptVersions).values({
    examId: id,
    version,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    modelId: process.env.GRADING_MODEL ?? 'claude-sonnet-4-6',
    rubricSnapshot: items,
  });

  await db.update(exams).set({ status: 'published' }).where(eq(exams.id, id));

  // Base candidate pool: all employees with 'employee' role
  const empRoles = await db.select().from(userRoles).where(eq(userRoles.role, 'employee'));
  let empIds = empRoles.map((r) => r.employeeId);

  // Optionally narrow down to specific employees and/or levels
  if (targetEmployeeIds?.length) {
    const targetSet = new Set(targetEmployeeIds);
    empIds = empIds.filter((empId) => targetSet.has(empId));
  }
  if (targetLevels?.length) {
    const levelRows = await db
      .select({ id: employees.id })
      .from(employees)
      .where(inArray(employees.level, targetLevels));
    const levelSet = new Set(levelRows.map((r) => r.id));
    empIds = empIds.filter((empId) => levelSet.has(empId));
  }

  if (empIds.length > 0) {
    // Insert exam_assignments for all assigned employees
    const now = new Date();
    await db
      .insert(examAssignments)
      .values(empIds.map((employeeId) => ({ examId: id, employeeId, assignedAt: now })))
      .onConflictDoNothing();

    // Fetch all assigned employees using inArray
    const empRows = await db
      .select()
      .from(employees)
      .where(inArray(employees.id, empIds));

    // Update notifiedAt for this batch
    await db
      .update(examAssignments)
      .set({ notifiedAt: now })
      .where(
        inArray(
          examAssignments.employeeId,
          empIds,
        ),
      );

    void sendWorkNotification(
      empRows.map((e) => e.dingtalkUserid),
      `新考试发布：${exam.title}`,
      `截止时间：${exam.deadline.toLocaleDateString('zh-CN')}，请尽快完成提交。`,
      id,
      empRows.map((e) => e.id),
    ).catch(console.error);
  }

  await audit(session.employeeId, 'exam.publish', 'exam', id);
  return ok({ published: true, promptVersion: version });
}
