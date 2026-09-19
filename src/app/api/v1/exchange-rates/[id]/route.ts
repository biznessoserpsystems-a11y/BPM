import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';

const CAN_MANAGE_EXCHANGE_RATES = ['ADMIN', 'MANAGER'];

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_EXCHANGE_RATES);
    if (roleError) return roleError;

    const { id } = await params;
    const rateId = Number(id);

    const existing = await db.exchangeRate.findUnique({
      where: { id: rateId },
      include: { currency: { select: { code: true } } },
    });
    if (!existing) {
      throw new PharmacyServiceError(`Exchange rate ${id} not found`);
    }

    await db.exchangeRate.delete({ where: { id: rateId } });

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'EXCHANGE_RATE_DELETED',
      entityName: 'ExchangeRate',
      entityId: id,
      details: { currency: existing.currency.code, rateDate: existing.rateDate.toISOString() },
    });

    return NextResponse.json({ message: 'Exchange rate deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}
