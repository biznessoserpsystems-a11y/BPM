import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import type { CreateFixedAssetInput } from '@/types/pharmacy';

// Same tier as Chart of Accounts / GL mappings — recording a fixed asset
// drives depreciation entries straight into the ledger.
const CAN_MANAGE_FIXED_ASSETS = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const assets = await db.fixedAsset.findMany({
      orderBy: { acquisitionDate: 'desc' },
      include: {
        assetAccount: { select: { accountCode: true, accountName: true } },
        depreciationEntries: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return NextResponse.json(assets);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_FIXED_ASSETS);
    if (roleError) return roleError;

    const body: CreateFixedAssetInput = await request.json();

    if (body.branchId && !(await canAccessBranch(db, auth, body.branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }

    if (!body.assetCode || !body.assetName || !body.category || !body.branchId || !body.acquisitionDate) {
      throw new PharmacyServiceError('assetCode, assetName, category, branchId, and acquisitionDate are required');
    }
    if (!body.acquisitionCost || body.acquisitionCost <= 0) {
      throw new PharmacyServiceError('acquisitionCost must be greater than zero');
    }
    if (!body.usefulLifeMonths || body.usefulLifeMonths <= 0) {
      throw new PharmacyServiceError('usefulLifeMonths must be greater than zero');
    }

    const existing = await db.fixedAsset.findUnique({ where: { assetCode: body.assetCode } });
    if (existing) {
      throw new PharmacyServiceError(`Asset code "${body.assetCode}" already exists`);
    }

    const asset = await db.fixedAsset.create({
      data: {
        assetCode: body.assetCode,
        assetName: body.assetName,
        category: body.category,
        branchId: body.branchId,
        acquisitionDate: new Date(body.acquisitionDate),
        acquisitionCost: body.acquisitionCost,
        residualValue: body.residualValue ?? 0,
        usefulLifeMonths: body.usefulLifeMonths,
        depreciationMethod: body.depreciationMethod ?? 'STRAIGHT_LINE',
        assetAccountId: body.assetAccountId,
        accumulatedDepreciationAccountId: body.accumulatedDepreciationAccountId,
        depreciationExpenseAccountId: body.depreciationExpenseAccountId,
      },
    });

    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
