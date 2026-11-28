import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import { loadUnitSetup, saveUnitSetup, validateUnitSetup } from '@/lib/product-units';

// Replace a product's whole unit setup: { baseUnit, packs: [{ name, unitsPer }] }
// — e.g. { baseUnit: "strip", packs: [{ name: "pack", unitsPer: 10 }] } for
// "1 pack = 10 strips". Admin/Manager only.
//
// This changes how FUTURE receipts are converted and what the screens call
// things. It never touches stock already on hand: that's stored as a plain
// count of base units, so renaming or resizing a unit here can't change it.
const CAN_EDIT_UNITS = ['ADMIN', 'MANAGER'];

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_EDIT_UNITS);
    if (roleError) return roleError;

    const { id } = await params;
    const productId = Number(id);
    const product = Number.isInteger(productId)
      ? await db.product.findFirst({ where: { id: productId, companyId: auth.companyId }, select: { id: true, brandName: true } })
      : null;
    if (!product) throw new PharmacyServiceError('Product not found');

    const body = await request.json();
    const setup = validateUnitSetup({ baseUnit: body?.baseUnit, packs: body?.packs });

    const before = await loadUnitSetup(db, product.id);
    await db.$transaction(async (tx) => {
      await saveUnitSetup(tx, product.id, setup);
      await writeAuditLog(tx, {
        branchId: auth.homeBranchId,
        userId: auth.userId,
        action: 'UPDATE_PRODUCT_UNITS',
        entityName: 'Product',
        entityId: String(product.id),
        details: { product: product.brandName, before, after: setup },
      });
    });

    return NextResponse.json({ productId: product.id, ...setup });
  } catch (error) {
    return handleApiError(error);
  }
}
