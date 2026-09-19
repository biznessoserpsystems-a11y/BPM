import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import type { CreatePayeTaxBandInput } from '@/types/pharmacy';

const CAN_MANAGE_PAYROLL = ['ADMIN', 'MANAGER'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const { id } = await params;
    const body: Partial<CreatePayeTaxBandInput> = await request.json();

    const existing = await db.payeTaxBand.findUnique({ where: { id: Number(id) } });
    if (!existing || existing.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Tax band not found');
    }
    if (body.maxAmount != null && body.minAmount != null && body.maxAmount <= body.minAmount) {
      throw new PharmacyServiceError('maxAmount must be greater than minAmount');
    }

    const updated = await db.payeTaxBand.update({
      where: { id: Number(id) },
      data: {
        minAmount: body.minAmount,
        maxAmount: body.maxAmount,
        ratePct: body.ratePct,
        sortOrder: body.sortOrder,
      },
    });

    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'PAYE_TAX_BAND_UPDATED',
      entityName: 'PayeTaxBand',
      entityId: String(updated.id),
      details: { minAmount: updated.minAmount, maxAmount: updated.maxAmount, ratePct: updated.ratePct },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const { id } = await params;
    const existing = await db.payeTaxBand.findUnique({ where: { id: Number(id) } });
    if (!existing || existing.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Tax band not found');
    }

    // Bands have no history to protect (past pay runs store the PAYE
    // amount actually charged, not a live reference to the band that
    // computed it) — safe to hard-delete.
    await db.payeTaxBand.delete({ where: { id: Number(id) } });

    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'PAYE_TAX_BAND_DELETED',
      entityName: 'PayeTaxBand',
      entityId: String(existing.id),
      details: { minAmount: existing.minAmount, maxAmount: existing.maxAmount, ratePct: existing.ratePct },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
