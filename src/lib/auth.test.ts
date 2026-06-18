import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  requireRole,
  isAdminRole,
  pickHighestPriorityRole,
  type SessionPayload,
  type UserRole,
} from './auth';

function reqWithCookie(token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set('cookie', `exam_session=${token}`);
  return new NextRequest('http://localhost/api/test', { headers });
}

describe('isAdminRole', () => {
  it('treats system_admin, exam_creator, and reviewer as admin roles', () => {
    expect(isAdminRole('system_admin')).toBe(true);
    expect(isAdminRole('exam_creator')).toBe(true);
    expect(isAdminRole('reviewer')).toBe(true);
  });

  it('does not treat employee as an admin role', () => {
    expect(isAdminRole('employee')).toBe(false);
  });
});

describe('pickHighestPriorityRole', () => {
  it('returns the only role for a single-role employee', () => {
    expect(pickHighestPriorityRole(['employee'])).toBe('employee');
  });

  it('picks the highest-priority role when an employee has several', () => {
    expect(pickHighestPriorityRole(['employee', 'exam_creator'])).toBe('exam_creator');
  });

  it('is order-independent', () => {
    const a: UserRole[] = ['reviewer', 'system_admin'];
    const b: UserRole[] = ['system_admin', 'reviewer'];
    expect(pickHighestPriorityRole(a)).toBe('system_admin');
    expect(pickHighestPriorityRole(b)).toBe('system_admin');
  });

  it('ranks system_admin > exam_creator > reviewer > employee', () => {
    expect(pickHighestPriorityRole(['employee', 'reviewer', 'exam_creator', 'system_admin'])).toBe('system_admin');
    expect(pickHighestPriorityRole(['employee', 'reviewer', 'exam_creator'])).toBe('exam_creator');
    expect(pickHighestPriorityRole(['employee', 'reviewer'])).toBe('reviewer');
  });

  it('falls back to employee when given no roles at all', () => {
    expect(pickHighestPriorityRole([])).toBe('employee');
  });
});

describe('session round trip', () => {
  const payload: Omit<SessionPayload, 'jti'> = { employeeId: 'emp-1', role: 'employee', name: '张三' };

  it('creates a session JWT that getSession verifies back via a request cookie', async () => {
    const token = await createSession(payload);
    const session = await getSession(reqWithCookie(token));
    expect(session).toMatchObject(payload);
  });

  it('gives every session a unique jti', async () => {
    const tokenA = await createSession(payload);
    const tokenB = await createSession(payload);
    const sessionA = await getSession(reqWithCookie(tokenA));
    const sessionB = await getSession(reqWithCookie(tokenB));
    expect(sessionA?.jti).toBeTruthy();
    expect(sessionA?.jti).not.toBe(sessionB?.jti);
  });

  it('returns null when there is no session cookie', async () => {
    const session = await getSession(reqWithCookie());
    expect(session).toBeNull();
  });

  it('returns null for a garbage/unsigned token', async () => {
    const session = await getSession(reqWithCookie('not-a-valid-jwt'));
    expect(session).toBeNull();
  });

  it('sets an httpOnly cookie via setSessionCookie', async () => {
    const token = await createSession(payload);
    const res = setSessionCookie(NextResponse.json({}), token);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toContain('exam_session=');
    expect(header).toContain('HttpOnly');
  });

  it('expires the cookie via clearSessionCookie', () => {
    const res = clearSessionCookie(NextResponse.json({}));
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toContain('exam_session=');
    expect(header).toContain('Max-Age=0');
  });
});

describe('requireRole', () => {
  const reviewer: Omit<SessionPayload, 'jti'> = { employeeId: 'emp-2', role: 'reviewer', name: 'Reviewer' };

  it('returns 401 when there is no session', async () => {
    const guard = requireRole('reviewer');
    const result = await guard(reqWithCookie());
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('returns 403 when the session role is not in the allowed list', async () => {
    const token = await createSession(reviewer);
    const guard = requireRole('system_admin');
    const result = await guard(reqWithCookie(token));
    expect((result as NextResponse).status).toBe(403);
  });

  it('returns the session payload when the role matches', async () => {
    const token = await createSession(reviewer);
    const guard = requireRole('reviewer', 'system_admin');
    const result = await guard(reqWithCookie(token));
    expect(result).toMatchObject(reviewer);
  });
});
