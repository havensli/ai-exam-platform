'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ExamSummary } from '@/lib/exam-summary';

interface FailedNotification {
  logId: string;
  employeeId: string;
  name: string;
  status: string;
  sentAt: string;
}

interface RosterRow {
  employeeId: string;
  name: string;
  level: string;
  submissionId: string | null;
  submittedAt: string | null;
  status: string;
  taskStatus: string | null;
  taskError: string | null;
  aiScore: number | null;
  finalScore: number | null;
}

const RETRIGGERABLE_STATUSES = ['pending', 'processing', 'sandbox_done'];

const ROSTER_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  not_submitted: { label: '未提交', cls: 'bg-gray-100 text-gray-500' },
  pending: { label: '待处理', cls: 'bg-yellow-100 text-yellow-700' },
  processing: { label: '沙箱执行中', cls: 'bg-blue-100 text-blue-700' },
  sandbox_done: { label: '待 AI 评分', cls: 'bg-blue-100 text-blue-700' },
  ai_graded: { label: 'AI 初评完成', cls: 'bg-brand-100 text-brand-700' },
  review_pending: { label: '待人工复核', cls: 'bg-orange-100 text-orange-700' },
  completed: { label: '已完成', cls: 'bg-green-100 text-green-700' },
};

export default function ExamSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<ExamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedNotifications, setFailedNotifications] = useState<FailedNotification[]>([]);
  const [resending, setResending] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [retriggering, setRetriggering] = useState<string | null>(null);

  function loadFailedNotifications() {
    fetch(`/api/exams/${id}/notifications`)
      .then((r) => r.json())
      .then(({ data }) => setFailedNotifications(data ?? []))
      .catch(() => {});
  }

  function loadRoster() {
    fetch(`/api/exams/${id}/roster`)
      .then((r) => r.json())
      .then(({ data }) => setRoster(data ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    fetch(`/api/exams/${id}/summary`)
      .then((r) => r.json())
      .then(({ data }) => setSummary(data))
      .finally(() => setLoading(false));
    loadFailedNotifications();
    loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function retrigger(submissionId: string) {
    setRetriggering(submissionId);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/regrade`, { method: 'POST' });
      const { error: e } = await res.json();
      if (e) { window.alert(e); return; }
      loadRoster();
    } finally {
      setRetriggering(null);
    }
  }

  async function resend(employeeId: string) {
    setResending(employeeId);
    try {
      await fetch(`/api/exams/${id}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: [employeeId] }),
      });
      loadFailedNotifications();
    } finally {
      setResending(null);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;
  if (!summary) return <div className="p-8 text-center text-red-500">加载失败</div>;

  const maxBucketCount = Math.max(1, ...summary.scoreDistribution.map((b) => b.count));

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">考核汇总报表</h1>
        <a
          href={`/api/exams/${id}/export`}
          className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 transition"
        >
          导出 Excel
        </a>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="已分配" value={summary.assignedCount} />
        <StatCard label="已提交" value={summary.submittedCount} />
        <StatCard label="提交率" value={`${(summary.submissionRate * 100).toFixed(0)}%`} />
        <StatCard label="平均分" value={summary.avgScore ?? '—'} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="最高分" value={summary.maxScoreSeen ?? '—'} />
        <StatCard label="最低分" value={summary.minScoreSeen ?? '—'} />
      </div>

      <Card title="分数分布">
        {summary.submittedCount === 0 ? (
          <p className="text-xs text-gray-400">暂无数据</p>
        ) : (
          <div className="space-y-1">
            {summary.scoreDistribution.map((b) => (
              <div key={b.bucket} className="flex items-center gap-2 text-xs">
                <span className="w-16 text-gray-500 shrink-0">{b.bucket}</span>
                <div className="flex-1 bg-gray-100 rounded h-4 overflow-hidden">
                  <div
                    className="bg-brand-500 h-4"
                    style={{ width: `${(b.count / maxBucketCount) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right text-gray-600">{b.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="按职级通过率">
        {Object.keys(summary.passRateByLevel).length === 0 ? (
          <p className="text-xs text-gray-400">暂无数据</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="font-normal pb-1">职级</th>
                <th className="font-normal pb-1">通过/总数</th>
                <th className="font-normal pb-1">通过率</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.passRateByLevel).map(([level, r]) => (
                <tr key={level} className="border-t border-gray-100">
                  <td className="py-1 text-gray-700">{level}</td>
                  <td className="py-1 text-gray-700">{r.passed} / {r.total}</td>
                  <td className="py-1 text-gray-700">{(r.rate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="通知未送达名单">
        {failedNotifications.length === 0 ? (
          <p className="text-xs text-gray-400">暂无未送达通知</p>
        ) : (
          <div className="space-y-2">
            {failedNotifications.map((f) => (
              <div key={f.employeeId} className="flex items-center justify-between text-xs border-t border-gray-100 pt-2">
                <span className="text-gray-700">{f.name}</span>
                <button
                  onClick={() => resend(f.employeeId)}
                  disabled={resending === f.employeeId}
                  className="bg-orange-500 text-white px-3 py-1 rounded-lg hover:bg-orange-600 disabled:opacity-50 transition"
                >
                  {resending === f.employeeId ? '发送中...' : '重新发送'}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="参与人员明细">
        {roster.length === 0 ? (
          <p className="text-xs text-gray-400">暂无数据</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="font-normal pb-1">姓名</th>
                <th className="font-normal pb-1">职级</th>
                <th className="font-normal pb-1">状态</th>
                <th className="font-normal pb-1">AI 初评分</th>
                <th className="font-normal pb-1">最终分</th>
                <th className="font-normal pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => {
                const statusInfo = ROSTER_STATUS_LABELS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-500' };
                const canRetrigger = r.submissionId && RETRIGGERABLE_STATUSES.includes(r.status);
                return (
                  <tr key={r.employeeId} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{r.name}</td>
                    <td className="py-1.5 text-gray-700">{r.level}</td>
                    <td className="py-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                      {r.taskError && (
                        <span className="ml-1 text-red-500" title={r.taskError}>⚠️</span>
                      )}
                    </td>
                    <td className="py-1.5 text-gray-700">{r.aiScore ?? '—'}</td>
                    <td className="py-1.5 text-gray-700">{r.finalScore ?? '—'}</td>
                    <td className="py-1.5 text-right">
                      {canRetrigger && (
                        <button
                          onClick={() => retrigger(r.submissionId!)}
                          disabled={retriggering === r.submissionId}
                          className="text-xs bg-orange-500 text-white px-2.5 py-1 rounded-lg hover:bg-orange-600 disabled:opacity-50 transition"
                        >
                          {retriggering === r.submissionId ? '触发中...' : '手动触发阅卷'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="AI 初评 与 人工复核 偏差">
        {!summary.aiVsHumanDeviation ? (
          <p className="text-xs text-gray-400">暂无已复核且有 AI 初评的提交</p>
        ) : (
          <div className="text-xs text-gray-700 space-y-1">
            <p>样本数：{summary.aiVsHumanDeviation.sampleSize}</p>
            <p>平均偏差（人工 − AI）：{summary.aiVsHumanDeviation.avgDeviation} 分</p>
            <p>标准差：{summary.aiVsHumanDeviation.stdDeviation}</p>
            {Math.abs(summary.aiVsHumanDeviation.avgDeviation) >= 5 && (
              <p className="text-orange-600 font-medium">
                偏差较大，建议复核评卷 Agent 是否存在系统性偏
                {summary.aiVsHumanDeviation.avgDeviation > 0 ? '低' : '高'}的打分倾向。
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
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
