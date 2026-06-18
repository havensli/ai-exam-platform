'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { loginWithAuthCode, redirectAfterLogin } from '@/lib/auth-client';

declare global {
  interface Window {
    DTFrameLogin?: (
      frameParams: { id: string; width?: number; height?: number },
      loginParams: {
        redirect_uri: string;
        client_id: string;
        scope: string;
        response_type: string;
        state?: string;
        prompt: string;
      },
      successCbk: (result: { redirectUrl: string; authCode: string; state: string }) => void,
      errorCbk: (errorMsg: string) => void,
    ) => void;
  }
}

const CONTAINER_ID = 'dt-qr-login-container';

// Must match exactly what's registered under "钉钉登录与分享" in the DingTalk
// developer console — this page only works same-origin with that value.
const REDIRECT_URI = 'https://ai-exam-platform-two.vercel.app/auth/login';

export default function QrLoginPage() {
  const [scriptReady, setScriptReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [failedAuthCode, setFailedAuthCode] = useState('');

  useEffect(() => {
    if (!scriptReady || !window.DTFrameLogin) return;
    // setState calls live inside this nested callback (not as bare effect-body
    // statements) — see src/app/auth/login/page.tsx for why that matters here.
    Promise.resolve().then(() => {
      const clientId = process.env.NEXT_PUBLIC_DINGTALK_APP_KEY;
      if (!clientId) {
        setError('未配置 NEXT_PUBLIC_DINGTALK_APP_KEY');
        return;
      }
      window.DTFrameLogin!(
        { id: CONTAINER_ID, width: 300, height: 300 },
        {
          redirect_uri: encodeURIComponent(REDIRECT_URI),
          client_id: clientId,
          scope: 'openid',
          response_type: 'code',
          prompt: 'consent',
        },
        (result) => {
          setLoading(true);
          loginWithAuthCode(result.authCode)
            .then((data) => redirectAfterLogin(data?.role))
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : '登录失败，请重试');
              setFailedAuthCode(result.authCode);
              setLoading(false);
            });
        },
        (errorMsg) => setError(errorMsg),
      );
    });
  }, [scriptReady]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Script
        src="https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js"
        onLoad={() => setScriptReady(true)}
      />
      <div className="bg-white rounded-xl shadow p-8 w-full max-w-sm text-center space-y-4">
        <h1 className="text-xl font-bold text-gray-900">钉钉扫码登录</h1>
        {!loading && !error && (
          <p className="text-xs text-gray-400">用手机钉钉扫描下方二维码，扫码确认后自动登录</p>
        )}
        <div id={CONTAINER_ID} className="mx-auto" style={{ width: 300, height: 300 }} />
        {loading && <p className="text-gray-500 text-sm">扫码成功，正在登录...</p>}
        {error && (
          <div className="space-y-2">
            <p className="text-red-500 text-sm">{error}</p>
            {failedAuthCode && (
              <p className="text-xs font-mono break-all bg-gray-100 rounded p-2">authCode: {failedAuthCode}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
