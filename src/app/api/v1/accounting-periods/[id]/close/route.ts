import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';

const CAN_CLOSE_PERIOD = ['ADMIN', 'MANAGER'];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_CLOSE_PERIOD);
    if (roleError) return roleError;

    const { id } = await params;
    const periodId = Number(id);
    // Always attribute this to the authenticated caller — never a
    // client-supplied userId — so the audit trail can't be forged by
    // naming a different (also privileged) user as the one who closed
    // the period.
    const closedByUserId = auth.userId;

    const period = await db.accountingPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new PharmacyServiceError('Accounting period not found');
    }
    if (period.status !== 'OPEN') {
      throw new PharmacyServiceError(`Period ${period.periodName} is already ${period.status}`);
    }

    // Every journal line dated inside this period must balance before it's
    // safe to close — this is the same debit=credit check the posting
    // service enforces per-entry, just re-verified in aggregate in case
    // anything ever got in around it (a raw seed script, a future bulk
    // import, etc.).
    const lines = await db.journalLine.findMany({
      where: { journalEntry: { entryDate: { gte: period.startDate, lte: period.endDate } } },
    });
    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new PharmacyServiceError(
        `Cannot close ${period.periodName}: ledger activity in this period is out of balance ` +
          `(debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}). Fix the underlying entries first.`
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: 'CLOSED', closedByUserId, closedAt: new Date() },
      });

      await writeAuditLog(tx, {
        userId: closedByUserId,
        action: 'CLOSE_ACCOUNTING_PERIOD',
        entityName: 'accounting_periods',
        entityId: String(periodId),
        details: { periodName: period.periodName },
      });

      return result;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
