import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { exams, submissions, employees, aiGradingResults, humanReviews, levelThresholds } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { err } from '@/lib/api';
import { eq, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !['system_admin', 'exam_creator', 'reviewer'].includes(session.role)) {
    return err('Forbidden', 403);
  }

  const { id } = await params;
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, id) });
  if (!exam) return err('Not found', 404);

  const subs = await db
    .select({
      submissionId: submissions.id,
      submittedAt: submissions.submittedAt,
      name: employees.name,
      department: employees.department,
      level: employees.level,
    })
    .from(submissions)
    .innerJoin(employees, eq(submissions.employeeId, employees.id))
    .where(eq(submissions.examId, id));

  const submissionIds = subs.map((s) => s.submissionId);

  const [aiRows, reviewRows, thresholdRows] = await Promise.all([
    submissionIds.length
      ? db.select().from(aiGradingResults).where(inArray(aiGradingResults.submissionId, submissionIds))
      : Promise.resolve([]),
    submissionIds.length
      ? db.select().from(humanReviews).where(inArray(humanReviews.submissionId, submissionIds))
      : Promise.resolve([]),
    db.select().from(levelThresholds).where(eq(levelThresholds.examId, id)),
  ]);

  const aiTotalsBySubmission = new Map<string, number>();
  for (const row of aiRows) {
    aiTotalsBySubmission.set(
      row.submissionId,
      (aiTotalsBySubmission.get(row.submissionId) ?? 0) + Number(row.score),
    );
  }
  const reviewBySubmission = new Map(reviewRows.map((r) => [r.submissionId, r]));
  const passScoreByLevel = new Map(thresholdRows.map((t) => [t.level, Number(t.passScore)]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('提交明细');
  sheet.columns = [
    { header: '姓名', key: 'name', width: 15 },
    { header: '部门', key: 'department', width: 15 },
    { header: '职级', key: 'level', width: 10 },
    { header: '提交时间', key: 'submittedAt', width: 20 },
    { header: 'AI初评分', key: 'aiScore', width: 12 },
    { header: '人工复核最终分', key: 'finalScore', width: 16 },
    { header: '是否通过', key: 'passed', width: 10 },
    { header: '复核意见', key: 'comment', width: 30 },
  ];

  for (const sub of subs) {
    const review = reviewBySubmission.get(sub.submissionId);
    const finalScore = review ? Number(review.finalScore) : null;
    const passScore = passScoreByLevel.get(sub.level);
    const passed = finalScore !== null && passScore !== undefined ? (finalScore >= passScore ? '通过' : '未通过') : '';

    sheet.addRow({
      name: sub.name,
      department: sub.department ?? '',
      level: sub.level,
      submittedAt: sub.submittedAt.toLocaleString('zh-CN'),
      aiScore: aiTotalsBySubmission.get(sub.submissionId) ?? '',
      finalScore: finalScore ?? '',
      passed,
      comment: review?.comment ?? '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="submissions-${id}.xlsx"`,
    },
  });
}
