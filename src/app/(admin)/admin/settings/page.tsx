'use client';

import { useEffect, useState } from 'react';

interface Setting {
  key: string;
  value: string;
  encrypted: boolean;
  updatedAt: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then(({ data }) => {
        const map: Record<string, Setting> = {};
        (data ?? []).forEach((s: Setting) => { map[s.key] = s; });
        setSettings(map);
        if (map['ai_grading_provider']) setProvider(map['ai_grading_provider'].value);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ai_grading_provider', value: provider }),
      });
      if (apiKey.trim()) {
        await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'ai_grading_api_key', value: apiKey.trim() }),
        });
        setApiKey('');
      }
      setSaved(true);
      load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;

  const currentKey = settings['ai_grading_api_key'];

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">系统设置</h1>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
        <h2 className="font-semibold text-gray-800 text-sm">AI 阅卷配置</h2>

        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-600">AI 服务提供商</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="minimax">MiniMax</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-600">API Key</label>
          {currentKey && (
            <p className="text-xs text-gray-400">
              当前：<span className="font-mono text-gray-600">{currentKey.value}</span>
              <span className="ml-2 text-gray-300">（已配置，留空不修改）</span>
            </p>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={currentKey ? '输入新 API Key 以替换' : '输入 API Key'}
            autoComplete="off"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none font-mono"
          />
          {provider === 'minimax' && (
            <p className="text-xs text-gray-400">MiniMax 使用模型 abab6.5s-chat，接口地址：api.minimax.chat</p>
          )}
          {provider === 'anthropic' && (
            <p className="text-xs text-gray-400">Anthropic 默认读取 Worker 侧 ANTHROPIC_API_KEY 环境变量；此处填写可覆盖</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 transition"
          >
            {saving ? '保存中...' : '保存设置'}
          </button>
          {saved && <span className="text-xs text-green-600">已保存 ✓</span>}
        </div>
      </div>
    </div>
  );
}
