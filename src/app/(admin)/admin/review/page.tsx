'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ReviewItem {
  submission: { id: string; status: string; submittedAt: string };
  employee: { name: string; level: string };
  exam: { title: string };
}

export default function ReviewListPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/review')
      .then((r) => r.json())
      .then(({ data }) => setItems(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold text-gray-900 mb-6">待复核列表</h1>
      <div className="space-y-3">
        {items.map(({ submission, employee, exam }) => (
          <div key={submission.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-gray-900">{employee.name}
                <span className="ml-2 text-xs text-gray-400 font-normal">({employee.level})</span>
              </p>
              <p className="text-sm text-gray-500">{exam.title}</p>
              <p className="text-xs text-gray-400 mt-1">{new Date(submission.submittedAt).toLocaleString('zh-CN')}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${submission.status === 'ai_graded' ? 'bg-brand-100 text-brand-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {submission.status === 'ai_graded' ? 'AI 初评完成' : '待处理'}
              </span>
              <Link
                href={`/admin/review/${submission.id}`}
                className="text-sm bg-brand-600 text-white px-4 py-1.5 rounded-lg hover:bg-brand-700 transition"
              >
                复核
              </Link>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-center text-gray-400 py-12">暂无待复核提交</p>}
      </div>
    </div>
  );
}
