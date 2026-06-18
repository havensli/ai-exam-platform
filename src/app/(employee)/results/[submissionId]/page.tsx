'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface GradingResult {
  rubricItemId: string;
  score: string;
  maxScore: string;
  reasoning: string;
  evidenceRef: unknown;
}

interface SubmissionDetail {
  id: string;
  status: string;
  deployUrl: string;
  repoUrl: string;
  submittedAt: string;
  aiGradingResults: GradingResult[];
}

export default function ResultsPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [appealSent, setAppealSent] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [showAppeal, setShowAppeal] = useState(false);

  useEffect(() => {
    fetch(`/api/submissions/${submissionId}`)
      .then((r) => r.json())
      .then(({ data: d }) => setData(d))
      .finally(() => setLoading(false));
  }, [submissionId]);

  async function submitAppeal() {
    const res = await fetch('/api/appeals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, reason: appealReason }),
    });
    if (res.ok) setAppealSent(true);
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">提交记录不存在</div>;

  const total = data.aiGradingResults.reduce((s, r) => s + Number(r.score), 0);
  const maxTotal = data.aiGradingResults.reduce((s, r) => s + Number(r.maxScore), 0);
  const isCompleted = data.status === 'completed';

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">提交详情</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">状态</span>
          <StatusBadge status={data.status} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">提交时间</span>
          <span className="text-sm">{new Date(data.submittedAt).toLocaleString('zh-CN')}</span>
        </div>
      </div>

      {isCompleted && data.aiGradingResults.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">评分结果</h2>
            <span className="text-2xl font-bold text-blue-600">{total} / {maxTotal}</span>
          </div>
          {data.aiGradingResults.map((r, i) => (
            <div key={i} className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">考点 {i + 1}</span>
                <span className="text-sm font-bold text-gray-900">{r.score} / {r.maxScore}</span>
              </div>
              {r.reasoning && <p className="text-xs text-gray-500">{r.reasoning}</p>}
            </div>
          ))}
        </div>
      )}

      {!isCompleted && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
          {data.status === 'pending' ? '提交已收到，等待 AI 阅卷...' :
           data.status === 'ai_graded' ? 'AI 初评完成，等待人工复核...' :
           '处理中...'}
        </div>
      )}

      {isCompleted && !appealSent && (
        <div>
          {!showAppeal ? (
            <button
              onClick={() => setShowAppeal(true)}
              className="w-full border border-gray-300 text-gray-700 rounded-lg py-2 text-sm hover:bg-gray-50 transition"
            >
              对成绩有异议？提交申诉
            </button>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
              <h3 className="font-medium text-gray-900">申诉说明</h3>
              <textarea
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] resize-none outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请详细说明你认为评分有误的原因..."
              />
              <div className="flex gap-2">
                <button onClick={submitAppeal} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 transition">
                  提交申诉
                </button>
                <button onClick={() => setShowAppeal(false)} className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm hover:bg-gray-50 transition">
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {appealSent && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          申诉已提交，将由另一位阅卷人重新复核。
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: '待阅卷', cls: 'bg-yellow-100 text-yellow-800' },
    ai_graded: { label: 'AI 初评完成', cls: 'bg-blue-100 text-blue-800' },
    completed: { label: '已出成绩', cls: 'bg-green-100 text-green-800' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}
