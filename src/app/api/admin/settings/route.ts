import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { systemSettings } from '@/db/schema';
import { getSession } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { encryptToken } from '@/lib/crypto';

const SENSITIVE_KEYS = new Set(['ai_grading_api_key']);

function maskValue(value: string): string {
  if (value.length <= 10) return '****';
  return value.slice(0, 6) + '****' + value.slice(-4);
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== 'system_admin') return err('Forbidden', 403);

  const rows = await db.select().from(systemSettings);
  return ok(
    rows.map((r) => ({
      key: r.key,
      value: r.encrypted ? maskValue(r.value) : r.value,
      encrypted: r.encrypted,
      updatedAt: r.updatedAt,
    })),
  );
}

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== 'system_admin') return err('Forbidden', 403);

  const body = upsertSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(body.error.message, 400);

  const { key, value } = body.data;
  const shouldEncrypt = SENSITIVE_KEYS.has(key);
  const storedValue = shouldEncrypt ? encryptToken(value) : value;

  await db
    .insert(systemSettings)
    .values({ key, value: storedValue, encrypted: shouldEncrypt, updatedAt: new Date(), updatedBy: session.employeeId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: storedValue, encrypted: shouldEncrypt, updatedAt: new Date(), updatedBy: session.employeeId },
    });

  return ok({ key, saved: true });
}
