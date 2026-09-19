import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import type { CreateRevenueContractInput } from '@/types/pharmacy';

// Same tier as Chart of Accounts / GL mappings — drives deferred-revenue
// recognition entries (IFRS 15).
const CAN_MANAGE_REVENUE_CONTRACTS = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const contracts = await db.revenueContract.findMany({
      orderBy: { startDate: 'desc' },
      include: { sale: { select: { invoiceNumber: true } } },
    });

    return NextResponse.json(contracts);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_REVENUE_CONTRACTS);
    if (roleError) return roleError;

    const body: CreateRevenueContractInput = await request.json();

    if (body.branchId && !(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    if (!body.contractCode || !body.branchId || !body.customerName || !body.startDate) {
      throw new PharmacyServiceError('contractCode, branchId, customerName, and startDate are required');
    }
    if (!body.totalContractValue || body.totalContractValue <= 0) {
      throw new PharmacyServiceError('totalContractValue must be greater than zero');
    }

    const existing = await db.revenueContract.findUnique({ where: { contractCode: body.contractCode } });
    if (existing) {
      throw new PharmacyServiceError(`Contract code "${body.contractCode}" already exists`);
    }

    const recognizedRevenue = body.recognizedRevenue ?? 0;
    if (recognizedRevenue > body.totalContractValue) {
      throw new PharmacyServiceError('recognizedRevenue cannot exceed totalContractValue');
    }

    const contract = await db.revenueContract.create({
      data: {
        contractCode: body.contractCode,
        branchId: body.branchId,
        customerName: body.customerName,
        saleId: body.saleId,
        totalContractValue: body.totalContractValue,
        recognizedRevenue,
        deferredRevenue: body.totalContractValue - recognizedRevenue,
        recognitionMethod: body.recognitionMethod ?? 'POINT_IN_TIME',
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        deferredRevenueAccountId: body.deferredRevenueAccountId,
      },
    });

    return NextResponse.json(contract, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
