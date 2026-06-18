import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { employees, userRoles } from '@/db/schema';
import { getUserAccessToken, getUserInfo } from '@/lib/dingtalk';
import { createSession, setSessionCookie, pickHighestPriorityRole, UserRole } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { eq } from 'drizzle-orm';

const schema = z.object({ authCode: z.string().min(1) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err('authCode is required', 400);

  let userAccessToken: string;
  try {
    userAccessToken = await getUserAccessToken(body.data.authCode);
  } catch (e) {
    return err(`DingTalk auth failed: ${(e as Error).message}`, 401);
  }

  let info: Awaited<ReturnType<typeof getUserInfo>>;
  try {
    info = await getUserInfo(userAccessToken);
  } catch (e) {
    return err(`Failed to get user info: ${(e as Error).message}`, 502);
  }

  let employee = await db.query.employees.findFirst({
    where: eq(employees.dingtalkUserid, info.userid),
  });

  if (!employee) {
    const [inserted] = await db
      .insert(employees)
      .values({
        dingtalkUserid: info.userid,
        name: info.name,
        department: info.department || null,
        level: 'junior',
      })
      .returning();
    employee = inserted;
    await db.insert(userRoles).values({ employeeId: employee.id, role: 'employee' });
  }

  const roleRows = await db.query.userRoles.findMany({
    where: eq(userRoles.employeeId, employee.id),
  });
  const role: UserRole = pickHighestPriorityRole(roleRows.map((r) => r.role as UserRole));

  const token = await createSession({ employeeId: employee.id, role, name: employee.name });
  const res = ok({ employeeId: employee.id, role, name: employee.name });
  return setSessionCookie(res as NextResponse, token);
}
