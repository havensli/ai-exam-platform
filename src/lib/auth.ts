import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { revokedTokens } from '@/db/schema';
import { eq } from 'drizzle-orm';

const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET ?? 'dev-secret-change-me');
const COOKIE_NAME = 'exam_session';

export type UserRole = 'system_admin' | 'exam_creator' | 'reviewer' | 'employee';

export interface SessionPayload {
  employeeId: string;
  role: UserRole;
  name: string;
  jti: string;
  /** Standard JWT claim (seconds since epoch), present on every decoded session. */
  exp?: number;
}

/** Highest-priority role wins. Pulled out as a pure function so it can be
 * unit tested without a database — callers query all of an employee's roles
 * and pass them in here to decide which one goes into the session. */
export function pickHighestPriorityRole(roles: UserRole[]): UserRole {
  const PRIORITY: UserRole[] = ['system_admin', 'exam_creator', 'reviewer', 'employee'];
  for (const candidate of PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  return 'employee';
}

export async function createSession(payload: Omit<SessionPayload, 'jti'>): Promise<string> {
  const jti = randomUUID();
  return new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(SECRET);
}

/** Only checked by a handful of high-privilege write routes (POST /api/exams,
 * POST /api/exams/[id]/publish, POST /api/review/[submissionId], PUT /api/appeals/[id]) —
 * everything else stays pure-signature-check with zero DB round trips. */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const row = await db.query.revokedTokens.findFirst({ where: eq(revokedTokens.jti, jti) });
  return Boolean(row);
}

export async function revokeToken(jti: string, expiresAt: Date): Promise<void> {
  await db.insert(revokedTokens).values({ jti, expiresAt }).onConflictDoNothing();
}

export async function getSession(req?: NextRequest): Promise<SessionPayload | null> {
  try {
    let token: string | undefined;
    if (req) {
      token = req.cookies.get(COOKIE_NAME)?.value;
    } else {
      const jar = await cookies();
      token = jar.get(COOKIE_NAME)?.value;
    }
    if (!token) return null;
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 86400,
    path: '/',
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
  return res;
}

export function requireRole(...roles: UserRole[]) {
  return async (req: NextRequest): Promise<SessionPayload | NextResponse> => {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 });
    }
    if (!roles.includes(session.role)) {
      return NextResponse.json({ data: null, error: 'Forbidden' }, { status: 403 });
    }
    return session;
  };
}

export function isAdminRole(role: UserRole): boolean {
  return ['system_admin', 'exam_creator', 'reviewer'].includes(role);
}
