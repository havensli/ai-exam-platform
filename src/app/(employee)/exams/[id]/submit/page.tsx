'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function SubmitPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState({
    deployUrl: '',
    repoUrl: '',
    gitToken: '',
    assumptionText: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examId: id,
          deployUrl: form.deployUrl,
          repoUrl: form.repoUrl,
          gitToken: form.gitToken || undefined,
          assumptionText: form.assumptionText || undefined,
        }),
      });
      const { data, error: apiError } = await res.json();
      if (apiError) { setError(apiError); return; }
      router.push(`/results/${data.id}`);
    } catch {
      setError('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-xl font-bold text-gray-900 mb-6">提交作业</h1>
      <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <Field label="部署 URL *">
          <input
            type="url"
            value={form.deployUrl}
            onChange={(e) => update('deployUrl', e.target.value)}
            className={input}
            placeholder="https://your-app.vercel.app"
            required
          />
        </Field>
        <Field label="Git 仓库地址 *">
          <input
            type="url"
            value={form.repoUrl}
            onChange={(e) => update('repoUrl', e.target.value)}
            className={input}
            placeholder="https://github.com/you/repo"
            required
          />
        </Field>
        <Field label="Git Token（私有仓库填写）">
          <input
            type="password"
            value={form.gitToken}
            onChange={(e) => update('gitToken', e.target.value)}
            className={input}
            placeholder="ghp_xxxxxxxxxxxx（只读权限即可）"
          />
          <p className="text-xs text-gray-400 mt-1">Token 仅用于 clone 仓库，阅卷完成后立即删除</p>
        </Field>
        <Field label="需求理解与假设说明 *">
          <textarea
            value={form.assumptionText}
            onChange={(e) => update('assumptionText', e.target.value)}
            className={`${input} min-h-[120px] resize-y`}
            placeholder="请描述你对需求的理解、做出的假设和关键技术决策..."
            required
          />
        </Field>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {submitting ? '提交中...' : '提交作业'}
        </button>
        <p className="text-xs text-gray-400 text-center">截止时间前可重新提交，系统保留最新版本</p>
      </form>
    </div>
  );
}

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
