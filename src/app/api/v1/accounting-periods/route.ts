import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { ensureRecentPeriods } from '@/lib/accounting-period';

/**
 * Lists accounting periods, auto-creating (as OPEN) any missing month in
 * the trailing window so the close/reopen screen always has rows to show
 * without a separate "set up periods" step. Existing periods — including
 * ones already closed — are left untouched.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    await db.$transaction((tx) => ensureRecentPeriods(tx, 12));

    const periods = await db.accountingPeriod.findMany({
      orderBy: { startDate: 'desc' },
      include: { closedByUser: { select: { fullName: true, username: true } } },
    });

    return NextResponse.json(periods);
  } catch (error) {
    return handleApiError(error);
  }
}
