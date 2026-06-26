'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface PendingItem {
  submissionId: string;
  submittedAt: string;
  status: string;
  examId: string;
  examTitle: string;
  employeeName: string;
  employeeLevel: string;
  taskStatus: string | null;
  taskError: string | null;
  taskRetryCount: number;
}

const RETRIGGERABLE = new Set(['pending', 'processing', 'sandbox_done']);

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: '阅卷中', cls: 'bg-yellow-100 text-yellow-700' },
  processing: { label: '阅卷中', cls: 'bg-blue-100 text-blue-700' },
  sandbox_done: { label: '阅卷中', cls: 'bg-blue-100 text-blue-700' },
  ai_graded: { label: '已阅卷待复核', cls: 'bg-green-100 text-green-700' },
};

export default function GradingPendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggeringAll, setTriggeringAll] = useState(false);

  function load() {
    fetch('/api/grading/pending')
      .then((r) => r.json())
      .then(({ data }) => setItems(data ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function trigger(submissionId: string) {
    setTriggering(submissionId);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/regrade`, { method: 'POST' });
      const { error } = await res.json();
      if (error) { window.alert(error); return; }
      load();
    } finally {
      setTriggering(null);
    }
  }

  async function triggerAll() {
    const retriggerable = items.filter((it) => RETRIGGERABLE.has(it.status));
    if (retriggerable.length === 0) return;
    if (!window.confirm(`将对全站 ${retriggerable.length} 条待阅卷提交重新触发 AI 阅卷，确认继续？`)) return;
    setTriggeringAll(true);
    try {
      const res = await fetch('/api/grading/trigger-all', { method: 'POST' });
      const { data, error } = await res.json();
      if (error) { window.alert(error); return; }
      window.alert(`已重新触发 ${data.requeued} 条提交的阅卷任务`);
      load();
    } finally {
      setTriggeringAll(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">阅卷管理</h1>
        <button
          onClick={triggerAll}
          disabled={triggeringAll || items.filter((it) => RETRIGGERABLE.has(it.status)).length === 0}
          className="text-sm bg-brand-600 text-white px-4 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50 transition"
        >
          {triggeringAll ? '触发中...' : '全量触发阅卷'}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left text-xs bg-gray-50">
              <th className="font-normal px-4 py-2">姓名</th>
              <th className="font-normal px-4 py-2">职级</th>
              <th className="font-normal px-4 py-2">考试</th>
              <th className="font-normal px-4 py-2">提交时间</th>
              <th className="font-normal px-4 py-2">状态</th>
              <th className="font-normal px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const statusInfo = STATUS_LABELS[it.status] ?? { label: it.status, cls: 'bg-gray-100 text-gray-500' };
              return (
                <tr key={it.submissionId} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-700">{it.employeeName}</td>
                  <td className="px-4 py-2 text-gray-700">{it.employeeLevel}</td>
                  <td className="px-4 py-2 text-gray-700">{it.examTitle}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{new Date(it.submittedAt).toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.cls}`}>
                      {statusInfo.label}
                    </span>
                    {it.taskError && <span className="ml-1 text-red-500" title={it.taskError}>⚠️</span>}
                    {it.taskRetryCount > 0 && <span className="ml-1 text-xs text-gray-400">重试 {it.taskRetryCount} 次</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {it.status === 'ai_graded' ? (
                      <Link
                        href={`/admin/review/${it.submissionId}`}
                        className="text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700 transition"
                      >
                        去复核
                      </Link>
                    ) : (
                      <button
                        onClick={() => trigger(it.submissionId)}
                        disabled={triggering === it.submissionId}
                        className="text-xs bg-orange-500 text-white px-2.5 py-1 rounded-lg hover:bg-orange-600 disabled:opacity-50 transition"
                      >
                        {triggering === it.submissionId ? '触发中...' : '触发阅卷'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {items.length === 0 && <p className="text-center text-gray-400 py-12">暂无进行中的阅卷任务</p>}
      </div>
    </div>
  );
}
