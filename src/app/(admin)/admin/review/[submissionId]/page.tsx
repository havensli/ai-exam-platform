'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Detail {
  submission: { id: string; deployUrl: string; repoUrl: string; assumptionText: string };
  employee: { name: string; level: string; department: string };
  exam: { title: string };
  grading: Array<{ rubricItemId: string; score: string; maxScore: string; reasoning: string; evidenceRef: unknown }>;
  sandbox: Array<{ phase: string; returncode: number; stdout: string; stderr: string; timedOut: boolean; oomKilled: boolean }>;
  auto: Array<{ checkName: string; passed: boolean; rawOutput: string }>;
  plagiarism: Array<{ checkType: string; score: string; flagged: boolean; detail: unknown }>;
  rubric: Array<{ id: string; name: string; criteriaText: string }>;
}

const ANOMALY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: '无异常' },
  { value: 'sandbox_failure', label: '沙箱执行失败' },
  { value: 'plagiarism_suspected', label: '疑似抄袭' },
  { value: 'network_issue', label: '网络问题' },
  { value: 'missing_materials', label: '材料缺失' },
  { value: 'other', label: '其他' },
];

export default function ReviewDetailPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [overallComment, setOverallComment] = useState('');
  const [anomalyType, setAnomalyType] = useState('none');
  const [anomalyNote, setAnomalyNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/review/${submissionId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setDetail(data);
        const initial: Record<string, number> = {};
        (data?.grading ?? []).forEach((g: Detail['grading'][0]) => {
          initial[g.rubricItemId] = Number(g.score);
        });
        setScores(initial);
      })
      .finally(() => setLoading(false));
  }, [submissionId]);

  async function submitReview() {
    if (!detail) return;
    setSubmitting(true);
    const finalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const adjustedItems = detail.grading
      .filter((g) => scores[g.rubricItemId] !== Number(g.score))
      .map((g) => ({ rubricItemId: g.rubricItemId, newScore: scores[g.rubricItemId], reason: '人工修正' }));

    await fetch(`/api/review/${submissionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finalScore, adjustedItems, comment: overallComment, anomalyType, anomalyNote }),
    });
    setSubmitting(false);
    router.push('/admin/review');
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;
  if (!detail) return <div className="p-8 text-center text-red-500">未找到提交记录</div>;

  const finalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const maxScore = detail.grading.reduce((a, g) => a + Number(g.maxScore), 0);
  const flagged = detail.plagiarism.filter((p) => p.flagged);
  const rubricById = new Map(detail.rubric.map((r) => [r.id, r]));

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-xl font-bold text-gray-900 mb-6">
        复核：{detail.employee.name} — {detail.exam.title}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: info + plagiarism */}
        <div className="space-y-4">
          <Card title="基本信息">
            <InfoRow label="姓名" value={detail.employee.name} />
            <InfoRow label="职级" value={detail.employee.level} />
            <InfoRow label="部门" value={detail.employee.department} />
            <InfoRow label="部署地址" value={<a href={detail.submission.deployUrl} target="_blank" rel="noreferrer" className="text-brand-600 text-xs break-all hover:underline">{detail.submission.deployUrl}</a>} />
            <InfoRow label="仓库地址" value={<a href={detail.submission.repoUrl} target="_blank" rel="noreferrer" className="text-brand-600 text-xs break-all hover:underline">{detail.submission.repoUrl}</a>} />
          </Card>

          {detail.submission.assumptionText && (
            <Card title="需求理解说明">
              <p className="text-xs text-gray-600 whitespace-pre-wrap">{detail.submission.assumptionText}</p>
            </Card>
          )}

          {flagged.length > 0 && (
            <Card title="⚠️ 防作弊标记">
              {flagged.map((p, i) => (
                <div key={i} className="text-xs border border-red-200 rounded p-2 bg-red-50">
                  <span className="font-medium text-red-700">{p.checkType}</span>
                  {p.score && <span className="ml-2 text-red-600">相似度 {Number(p.score).toFixed(1)}%</span>}
                </div>
              ))}
            </Card>
          )}

          <Card title="自动化检测">
            {detail.auto.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span>{c.passed ? '✅' : '❌'}</span>
                <span className="text-gray-700">{c.checkName}</span>
              </div>
            ))}
            {detail.auto.length === 0 && <p className="text-xs text-gray-400">无检测结果</p>}
          </Card>
        </div>

        {/* Middle: grading */}
        <div className="space-y-4">
          <Card title={`逐项评分（当前合计：${finalScore} / ${maxScore}）`}>
            {detail.grading.map((g, i) => {
              const rubric = rubricById.get(g.rubricItemId);
              return (
                <div key={i} className="border border-gray-100 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{rubric?.name ?? `考点 ${i + 1}`}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={scores[g.rubricItemId] ?? Number(g.score)}
                        onChange={(e) => setScores((s) => ({ ...s, [g.rubricItemId]: Number(e.target.value) }))}
                        min={0}
                        max={Number(g.maxScore)}
                        className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center focus:ring-2 focus:ring-brand-500 outline-none"
                      />
                      <span className="text-xs text-gray-400">/ {g.maxScore}</span>
                    </div>
                  </div>
                  {rubric?.criteriaText && (
                    <p className="text-xs text-gray-400 bg-gray-50 rounded p-2">评分细则：{rubric.criteriaText}</p>
                  )}
                  {g.reasoning && <p className="text-xs text-gray-500">AI 评语：{g.reasoning}</p>}
                  {scores[g.rubricItemId] !== Number(g.score) && (
                    <p className="text-xs text-orange-600 font-medium">
                      AI 原始分：{g.score} → 已修改为 {scores[g.rubricItemId]}
                    </p>
                  )}
                </div>
              );
            })}
            {detail.grading.length === 0 && <p className="text-xs text-gray-400">AI 评分未完成</p>}
          </Card>

          <Card title="整体备注">
            <textarea
              value={overallComment}
              onChange={(e) => setOverallComment(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] resize-none focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="可选：整体评价备注..."
            />
          </Card>

          <Card title="异常原因">
            <select
              value={anomalyType}
              onChange={(e) => setAnomalyType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              {ANOMALY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {anomalyType !== 'none' && (
              <textarea
                value={anomalyNote}
                onChange={(e) => setAnomalyNote(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[60px] resize-none focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="请说明异常详情..."
              />
            )}
          </Card>

          <button
            onClick={submitReview}
            disabled={submitting}
            className="w-full bg-green-600 text-white rounded-lg py-3 font-semibold hover:bg-green-700 disabled:opacity-50 transition"
          >
            {submitting ? '提交中...' : `确认复核（最终得分：${finalScore} 分）`}
          </button>
        </div>

        {/* Right: sandbox */}
        <div className="space-y-4">
          <Card title="沙箱执行结果">
            {detail.sandbox.map((s, i) => (
              <div key={i} className={`rounded-lg p-3 text-xs space-y-1 ${s.timedOut || s.oomKilled ? 'bg-red-50 border border-red-200' : s.returncode === 0 ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex items-center gap-2 font-medium">
                  <span className="capitalize text-gray-700">{s.phase}</span>
                  {s.timedOut && <span className="text-red-600">⏱ 超时</span>}
                  {s.oomKilled && <span className="text-red-600">💀 OOM</span>}
                  {!s.timedOut && !s.oomKilled && (
                    <span className={s.returncode === 0 ? 'text-green-600' : 'text-red-600'}>
                      exit {s.returncode}
                    </span>
                  )}
                </div>
                {s.stdout && (
                  <pre className="bg-white rounded p-2 overflow-x-auto text-xs text-gray-600 max-h-32">
                    {s.stdout.slice(0, 2000)}
                  </pre>
                )}
                {s.stderr && (
                  <pre className="bg-white rounded p-2 overflow-x-auto text-xs text-red-500 max-h-32">
                    {s.stderr.slice(0, 1000)}
                  </pre>
                )}
              </div>
            ))}
            {detail.sandbox.length === 0 && <p className="text-xs text-gray-400">沙箱执行结果暂无</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
      <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-400 w-16 shrink-0">{label}</span>
      <span className="text-gray-700">{value}</span>
    </div>
  );
}
