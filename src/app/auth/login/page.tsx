'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { loginWithAuthCode, redirectAfterLogin } from '@/lib/auth-client';

function isDingTalkEnv(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.userAgent.includes('DingTalk');
}

async function getDingTalkAuthCode(corpId: string): Promise<string> {
  // Dynamic import: dingtalk-jsapi touches browser globals at module-eval time,
  // which breaks Next.js's SSR prerendering if imported statically.
  const { default: dd } = await import('dingtalk-jsapi');
  // dd.runtime.permission.requestAuthCode needs no dd.config/dd.ready — it queues
  // automatically until the JS bridge is ready (see dingtalk-jsapi README).
  const { code } = await dd.runtime.permission.requestAuthCode({ corpId });
  return code;
}

function subscribeNever() {
  return () => {};
}

function getServerSnapshot() {
  return false;
}

export default function LoginPage() {
  const [authCode, setAuthCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Read client-only env detection via useSyncExternalStore (not effect+setState)
  // so SSR renders the non-DingTalk fallback with no hydration mismatch.
  const inDingTalk = useSyncExternalStore(subscribeNever, isDingTalkEnv, getServerSnapshot);

  useEffect(() => {
    if (!inDingTalk) return;
    const corpId = process.env.NEXT_PUBLIC_DINGTALK_CORP_ID;
    // All state updates happen inside the promise callbacks (not as bare
    // statements in the effect body) to synchronize with the async auth flow.
    Promise.resolve()
      .then(() => {
        setLoading(true);
        if (!corpId) throw new Error('未配置 NEXT_PUBLIC_DINGTALK_CORP_ID');
        return getDingTalkAuthCode(corpId);
      })
      .then((code) => loginWithAuthCode(code))
      .then((data) => {
        redirectAfterLogin(data?.role);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '钉钉授权失败，请重试');
        setLoading(false);
      });
  }, [inDingTalk]);

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await loginWithAuthCode(authCode);
      redirectAfterLogin(data?.role);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  // In DingTalk environment: auto-login, show spinner or error
  if (inDingTalk) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">AI 考试系统</h1>
          {loading && (
            <p className="text-gray-500 text-sm">正在通过钉钉授权登录，请稍候...</p>
          )}
          {error && (
            <>
              <p className="text-red-500 text-sm mb-4">{error}</p>
              <button
                onClick={() => {
                  setError('');
                  setLoading(true);
                  const corpId = process.env.NEXT_PUBLIC_DINGTALK_CORP_ID ?? '';
                  getDingTalkAuthCode(corpId)
                    .then((code) => loginWithAuthCode(code))
                    .then((data) => {
                      redirectAfterLogin(data?.role);
                    })
                    .catch((e: unknown) => {
                      setError(e instanceof Error ? e.message : '钉钉授权失败');
                      setLoading(false);
                    });
                }}
                className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 transition"
              >
                重新授权
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Not in DingTalk environment: keep manual authCode input as the fallback
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">AI 考试系统</h1>
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">钉钉授权码</label>
            <input
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="粘贴钉钉授权码"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? '登录中...' : '钉钉登录'}
          </button>
        </form>
        <a href="/auth/qrlogin" className="block text-center text-xs text-blue-600 hover:underline mt-4">
          没有授权码？扫码登录 →
        </a>
      </div>
    </div>
  );
}
