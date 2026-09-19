import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';

const CAN_REOPEN_PERIOD = ['ADMIN', 'MANAGER'];

/**
 * Reopening is intentionally a one-step, fully-logged action rather than a
 * hard wall — real corrections happen after a month closes. `LOCKED`
 * periods (a stricter status reserved for periods old enough that they've
 * already been reported on externally) are deliberately NOT reopenable
 * through this endpoint; that needs a schema/UI decision of its own.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_REOPEN_PERIOD);
    if (roleError) return roleError;

    const { id } = await params;
    const periodId = Number(id);
    const body = await request.json().catch(() => ({}));
    // Always attribute this to the authenticated caller — never a
    // client-supplied userId — so the audit trail can't be forged.
    const reopenedByUserId = auth.userId;
    const reason: string | undefined = body.reason;

    const period = await db.accountingPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new PharmacyServiceError('Accounting period not found');
    }
    if (period.status === 'LOCKED') {
      throw new PharmacyServiceError(`Period ${period.periodName} is LOCKED and cannot be reopened here`);
    }
    if (period.status !== 'CLOSED') {
      throw new PharmacyServiceError(`Period ${period.periodName} is already ${period.status}`);
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: 'OPEN', closedByUserId: null, closedAt: null },
      });

      await writeAuditLog(tx, {
        userId: reopenedByUserId,
        action: 'REOPEN_ACCOUNTING_PERIOD',
        entityName: 'accounting_periods',
        entityId: String(periodId),
        details: { periodName: period.periodName, reason: reason ?? null },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
