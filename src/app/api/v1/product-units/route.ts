import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { DEFAULT_BASE_UNIT, loadUnitSetup } from '@/lib/product-units';

// Read how products are counted and packed (see the ProductUnit model).
//  ?productId=12  -> that product's setup: { productId, baseUnit, packs }
//  (no productId) -> every product in the caller's company that HAS a setup;
//                    products with none are "piece" with no packaging.
// Open to any signed-in user: receiving stock needs to read it, and it's not
// sensitive. Changing it is Admin/Manager only (PUT /products/[id]/units).
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const productIdParam = request.nextUrl.searchParams.get('productId');
    if (productIdParam) {
      const productId = Number(productIdParam);
      const product = Number.isInteger(productId)
        ? await db.product.findFirst({ where: { id: productId, companyId: auth.companyId }, select: { id: true } })
        : null;
      if (!product) throw new PharmacyServiceError('Product not found');
      return NextResponse.json({ productId, ...(await loadUnitSetup(db, productId)) });
    }

    const rows = await db.productUnit.findMany({
      where: { product: { companyId: auth.companyId } },
      orderBy: [{ productId: 'asc' }, { unitsPer: 'asc' }, { name: 'asc' }],
    });
    type Setup = { productId: number; baseUnit: string; packs: { name: string; unitsPer: number }[] };
    const byProduct = new Map<number, Setup>();
    for (const r of rows) {
      const entry: Setup = byProduct.get(r.productId) ?? { productId: r.productId, baseUnit: DEFAULT_BASE_UNIT, packs: [] };
      if (r.isBase) entry.baseUnit = r.name;
      else entry.packs.push({ name: r.name, unitsPer: r.unitsPer });
      byProduct.set(r.productId, entry);
    }
    return NextResponse.json([...byProduct.values()]);
  } catch (error) {
    return handleApiError(error);
  }
}
