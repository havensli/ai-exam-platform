import { NextResponse } from 'next/server';
import { db } from '@/db';
import { auditLogs } from '@/db/schema';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data, error: null }, { status });
}

export function err(message: string, status = 400): NextResponse {
  return NextResponse.json({ data: null, error: message }, { status });
}

export function sumRubricWeights(items: { weight: number }[]): number {
  return items.reduce((sum, item) => sum + item.weight, 0);
}

export async function audit(
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  payloadDiff?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: actorId ?? undefined,
    action,
    resourceType,
    resourceId,
    payloadDiff: payloadDiff ?? null,
  });
}
