import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, getSession, revokeToken } from '@/lib/auth';
import { ok } from '@/lib/api';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession(req);
  if (session) {
    const expiresAt = session.exp ? new Date(session.exp * 1000) : new Date(Date.now() + 86_400_000);
    await revokeToken(session.jti, expiresAt);
  }
  return clearSessionCookie(ok({ ok: true }) as NextResponse);
}
