import { NextRequest, NextResponse } from 'next/server';
import { getSession, isAdminRole } from '@/lib/auth';

const PUBLIC_PATHS = ['/auth', '/api/auth/dingtalk', '/api/auth/logout', '/_next', '/favicon'];

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/cron/')) {
    const auth = req.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (auth !== expected) {
      return NextResponse.json({ data: null, error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  const session = await getSession(req);
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/auth/login', req.url));
  }

  if (pathname.startsWith('/admin') && !isAdminRole(session.role)) {
    return NextResponse.redirect(new URL('/exams', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
