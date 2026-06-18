'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Exam {
  id: string;
  title: string;
  background: string;
  status: string;
  deadline: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    published: { label: '进行中', cls: 'bg-green-100 text-green-800' },
    closed: { label: '已截止', cls: 'bg-gray-100 text-gray-600' },
    draft: { label: '草稿', cls: 'bg-yellow-100 text-yellow-800' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/exams')
      .then((r) => r.json())
      .then(({ data }) => setExams(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">我的考试</h1>
        <Link href="/results" className="text-sm text-brand-600 hover:underline">
          历史成绩 →
        </Link>
      </div>
      {exams.length === 0 && (
        <p className="text-gray-500 text-center py-12">暂无考试</p>
      )}
      {exams.map((exam) => (
        <div key={exam.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-semibold text-gray-900">{exam.title}</h2>
                <StatusBadge status={exam.status} />
              </div>
              <p className="text-sm text-gray-500 line-clamp-2">{exam.background}</p>
              <p className="text-xs text-gray-400 mt-2">
                截止：{new Date(exam.deadline).toLocaleString('zh-CN')}
              </p>
            </div>
            {exam.status === 'published' && (
              <Link
                href={`/exams/${exam.id}/submit`}
                className="shrink-0 bg-brand-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-brand-700 transition"
              >
                提交
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
