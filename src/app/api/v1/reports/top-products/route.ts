import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { canAccessBranch, getCompanyBranchIds } from '@/lib/branch-access';
import { parseLocalDate } from '@/lib/week-range';
import { parseRange, rankProducts, type RankBy } from '@/lib/product-ranking';

// Products ranked by what they sold.
//
//   GET /api/v1/reports/top-products?from=2026-11-01&to=2026-11-28&rankBy=quantity&limit=20&branchId=BR-1
//
//   from, to   inclusive dates (required)
//   rankBy     'quantity' (default) or 'revenue'
//   limit      rows to return, 1–200 (default 20)
//   branchId   one branch; omit for everything the caller may see
//
// Same visibility rules as the weekly report: an Admin or Manager sees any
// branch of their company (or all combined); anyone else sees their own
// branch. Returns made in the period are taken off the product they came back
// against.
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const q = request.nextUrl.searchParams;

    const range = parseRange(q.get('from'), q.get('to'), parseLocalDate);
    if ('error' in range) throw new PharmacyServiceError(range.error);

    const rankBy: RankBy = q.get('rankBy') === 'revenue' ? 'revenue' : 'quantity';
    const limit = Math.min(200, Math.max(1, Math.floor(Number(q.get('limit'))) || 20));

    const requestedBranchId = q.get('branchId') || undefined;
    if (requestedBranchId && !(await canAccessBranch(db, auth, requestedBranchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    const seesWholeCompany = auth.roleName === 'ADMIN' || auth.roleName === 'MANAGER';
    const branchIds = requestedBranchId
      ? [requestedBranchId]
      : seesWholeCompany
        ? await getCompanyBranchIds(db, auth.companyId)
        : [auth.homeBranchId];

    const items = await db.saleItem.findMany({
      where: { sale: { branchId: { in: branchIds }, saleDate: { gte: range.from, lt: range.to } } },
      select: {
        saleId: true,
        productId: true,
        quantity: true,
        subtotal: true,
        product: { select: { brandName: true, genericName: true, skuCode: true } },
        salesReturnItems: { select: { quantity: true, amount: true } },
      },
    });

    const result = rankProducts(
      items.map((i) => ({
        saleId: i.saleId,
        productId: i.productId,
        productName: i.product.brandName,
        genericName: i.product.genericName,
        sku: i.product.skuCode,
        quantity: i.quantity,
        amount: i.subtotal,
        returnedQuantity: i.salesReturnItems.reduce((n, r) => n + r.quantity, 0),
        returnedAmount: i.salesReturnItems.reduce((n, r) => n + r.amount, 0),
      })),
      rankBy,
      limit
    );

    return NextResponse.json({
      from: q.get('from'),
      to: q.get('to'),
      branchId: requestedBranchId ?? null,
      rankBy,
      ...result,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
