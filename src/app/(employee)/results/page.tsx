'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MySubmission {
  submissionId: string;
  examTitle: string;
  status: string;
  submittedAt: string;
  finalScore: number | null;
  passed: boolean | null;
}

export default function MyResultsPage() {
  const [items, setItems] = useState<MySubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/submissions/mine')
      .then((r) => r.json())
      .then(({ data }) => setItems(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">我的历史成绩</h1>
      {items.length === 0 && <p className="text-gray-500 text-center py-12">暂无记录</p>}
      <div className="space-y-3">
        {items.map((item) => (
          <Link
            key={item.submissionId}
            href={`/results/${item.submissionId}`}
            className="block bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:border-blue-300 transition"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">{item.examTitle}</h2>
              {item.finalScore !== null ? (
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${item.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {item.finalScore} 分 · {item.passed ? '通过' : '未通过'}
                </span>
              ) : (
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">待复核</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">{new Date(item.submittedAt).toLocaleString('zh-CN')}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
