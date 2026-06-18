// Client-side helper shared by the in-DingTalk auto-login flow
// (src/app/auth/login/page.tsx) and the desktop QR-login flow
// (src/app/auth/qrlogin/page.tsx). Deliberately separate from
// src/lib/auth.ts, which is server-only (imports the DB).

export async function loginWithAuthCode(authCode: string): Promise<{ role: string }> {
  const res = await fetch('/api/auth/dingtalk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authCode }),
  });
  const { data, error } = await res.json();
  if (error) throw new Error(error);
  return data;
}

export function redirectAfterLogin(role: string | undefined): void {
  window.location.href = role === 'employee' ? '/exams' : '/admin/exams';
}
