'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Exam {
  id: string;
  title: string;
  status: string;
  deadline: string;
  createdAt: string;
  needsOwnerTransfer: boolean;
}

export default function AdminExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/exams')
      .then((r) => r.json())
      .then(({ data }) => setExams(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function publish(id: string) {
    await fetch(`/api/exams/${id}/publish`, { method: 'POST' });
    setExams((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'published' } : e)));
  }

  async function duplicate(id: string) {
    const res = await fetch(`/api/exams/${id}/duplicate`, { method: 'POST' });
    const { data, error: e } = await res.json();
    if (e || !data) return;
    window.location.href = `/admin/exams/new?examId=${data.id}`;
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">考试管理</h1>
        <Link
          href="/admin/exams/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          + 新建考试
        </Link>
      </div>
      <div className="space-y-3">
        {exams.map((exam) => (
          <div key={exam.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-semibold text-gray-900">{exam.title}</h2>
                <StatusChip status={exam.status} />
                {exam.needsOwnerTransfer && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                    ⚠️ 原负责人已离职，待指定新负责人
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">
                截止：{new Date(exam.deadline).toLocaleString('zh-CN')}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {exam.status === 'draft' && (
                <button
                  onClick={() => publish(exam.id)}
                  className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition"
                >
                  发布
                </button>
              )}
              <Link
                href={`/admin/exams/${exam.id}/summary`}
                className="text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
              >
                汇总报表
              </Link>
              <button
                onClick={() => duplicate(exam.id)}
                className="text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
              >
                复制为新考试
              </button>
              <Link
                href={`/admin/review`}
                className="text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
              >
                复核
              </Link>
            </div>
          </div>
        ))}
        {exams.length === 0 && <p className="text-center text-gray-400 py-12">暂无考试</p>}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-700',
    published: 'bg-green-100 text-green-700',
    closed: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<string, string> = { draft: '草稿', published: '已发布', closed: '已截止' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[status] ?? status}
    </span>
  );
}
