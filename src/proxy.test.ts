import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { createSession, type SessionPayload } from '@/lib/auth';

function isNext(res: { headers: Headers }): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

function makeReq(
  pathname: string,
  opts: { token?: string; authorization?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (opts.token) headers.set('cookie', `exam_session=${opts.token}`);
  if (opts.authorization) headers.set('authorization', opts.authorization);
  return new NextRequest(new URL(pathname, 'http://localhost'), { headers });
}

describe('proxy', () => {
  it('lets public paths through without a session', async () => {
    const res = await proxy(makeReq('/auth/login'));
    expect(isNext(res)).toBe(true);
  });

  it('forbids cron routes without the correct bearer secret', async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'super-secret';
    try {
      const res = await proxy(makeReq('/api/cron/check-deadlines'));
      expect(res.status).toBe(403);
    } finally {
      process.env.CRON_SECRET = original;
    }
  });

  it('allows cron routes with the correct bearer secret', async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'super-secret';
    try {
      const res = await proxy(
        makeReq('/api/cron/check-deadlines', { authorization: 'Bearer super-secret' }),
      );
      expect(isNext(res)).toBe(true);
    } finally {
      process.env.CRON_SECRET = original;
    }
  });

  it('returns 401 JSON for unauthenticated API requests', async () => {
    const res = await proxy(makeReq('/api/exams'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('redirects unauthenticated page requests to /auth/login', async () => {
    const res = await proxy(makeReq('/exams'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/auth/login');
  });

  it('redirects non-admin roles away from /admin', async () => {
    const employee: Omit<SessionPayload, 'jti'> = { employeeId: 'emp-1', role: 'employee', name: 'Employee' };
    const token = await createSession(employee);
    const res = await proxy(makeReq('/admin/exams', { token }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/exams');
  });

  it('lets admin roles through to /admin', async () => {
    const admin: Omit<SessionPayload, 'jti'> = { employeeId: 'emp-2', role: 'system_admin', name: 'Admin' };
    const token = await createSession(admin);
    const res = await proxy(makeReq('/admin/exams', { token }));
    expect(isNext(res)).toBe(true);
  });

  it('lets authenticated employees through to non-admin pages', async () => {
    const employee: Omit<SessionPayload, 'jti'> = { employeeId: 'emp-3', role: 'employee', name: 'Employee' };
    const token = await createSession(employee);
    const res = await proxy(makeReq('/exams', { token }));
    expect(isNext(res)).toBe(true);
  });
});
