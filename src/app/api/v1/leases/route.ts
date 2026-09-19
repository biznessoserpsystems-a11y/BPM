import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import type { CreateLeaseInput } from '@/types/pharmacy';

// Same tier as Chart of Accounts / GL mappings — a lease drives right-of-use
// asset and liability entries straight into the ledger (IFRS 16).
const CAN_MANAGE_LEASES = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const leases = await db.lease.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        payments: { orderBy: { periodId: 'desc' }, take: 1 },
      },
    });

    return NextResponse.json(leases);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_LEASES);
    if (roleError) return roleError;

    const body: CreateLeaseInput = await request.json();

    if (body.branchId && !(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    if (!body.leaseCode || !body.branchId || !body.description || !body.lessor || !body.startDate || !body.endDate) {
      throw new PharmacyServiceError('leaseCode, branchId, description, lessor, startDate, and endDate are required');
    }
    if (new Date(body.endDate) <= new Date(body.startDate)) {
      throw new PharmacyServiceError('endDate must be after startDate');
    }
    if (!body.rouAssetValue || !body.leaseLiability) {
      throw new PharmacyServiceError('rouAssetValue and leaseLiability are required');
    }

    const existing = await db.lease.findUnique({ where: { leaseCode: body.leaseCode } });
    if (existing) {
      throw new PharmacyServiceError(`Lease code "${body.leaseCode}" already exists`);
    }

    const lease = await db.lease.create({
      data: {
        leaseCode: body.leaseCode,
        branchId: body.branchId,
        description: body.description,
        lessor: body.lessor,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        monthlyPayment: body.monthlyPayment,
        discountRate: body.discountRate,
        rouAssetValue: body.rouAssetValue,
        leaseLiability: body.leaseLiability,
        rouAssetAccountId: body.rouAssetAccountId,
        leaseLiabilityAccountId: body.leaseLiabilityAccountId,
      },
    });

    return NextResponse.json(lease, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
