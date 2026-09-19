import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { PharmacyServiceError } from '@/lib/errors';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    const purchaseOrderId = request.nextUrl.searchParams.get('purchaseOrderId');

    if (branchId && !(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const companyBranchIds = branchId ? undefined : await getCompanyBranchIds(db, auth.companyId);

    const where: Record<string, unknown> = branchId ? { branchId } : { branchId: { in: companyBranchIds } };
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;

    const receipts = await db.goodsReceipt.findMany({
      where,
      include: {
        purchaseOrder: { select: { poNumber: true, supplierId: true, supplier: { select: { name: true } } } },
        receivedByUser: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: true, batch: true } },
      },
      orderBy: { receivedDate: 'desc' },
    });

    return NextResponse.json(receipts);
  } catch (error) {
    return handleApiError(error);
  }
}
