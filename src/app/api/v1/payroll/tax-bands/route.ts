import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import type { CreatePayeTaxBandInput } from '@/types/pharmacy';

const CAN_MANAGE_PAYROLL = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const bands = await db.payeTaxBand.findMany({
      where: { companyId: auth.companyId },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json(bands);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_PAYROLL);
    if (roleError) return roleError;

    const body: CreatePayeTaxBandInput = await request.json();

    if (body.minAmount == null || body.ratePct == null || body.sortOrder == null) {
      throw new PharmacyServiceError('minAmount, ratePct, and sortOrder are required');
    }
    if (body.maxAmount != null && body.maxAmount <= body.minAmount) {
      throw new PharmacyServiceError('maxAmount must be greater than minAmount');
    }
    if (body.ratePct < 0 || body.ratePct > 100) {
      throw new PharmacyServiceError('ratePct must be between 0 and 100');
    }

    const band = await db.payeTaxBand.create({
      data: {
        companyId: auth.companyId,
        minAmount: body.minAmount,
        maxAmount: body.maxAmount,
        ratePct: body.ratePct,
        sortOrder: body.sortOrder,
      },
    });

    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'PAYE_TAX_BAND_CREATED',
      entityName: 'PayeTaxBand',
      entityId: String(band.id),
      details: { minAmount: band.minAmount, maxAmount: band.maxAmount, ratePct: band.ratePct },
    });

    return NextResponse.json(band, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
