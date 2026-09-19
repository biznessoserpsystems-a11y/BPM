import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { UpdateSupplierInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';

const CAN_LINK_AP_ACCOUNT = ['ADMIN', 'MANAGER'];

async function validateApAccount(companyId: string, apAccountId: number | undefined | null) {
  if (apAccountId == null) return;
  const account = await db.account.findUnique({ where: { id: apAccountId } });
  if (!account || account.companyId !== companyId) {
    throw new PharmacyServiceError(`Account ${apAccountId} not found`);
  }
  if (account.accountType !== 'LIABILITY') {
    throw new PharmacyServiceError(
      `Accounts Payable must link to a LIABILITY account — "${account.accountName}" is ${account.accountType}`
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const supplier = await db.supplier.findUnique({
      where: { id: Number(id) },
      include: {
        batches: true,
        apAccount: { select: { id: true, accountCode: true, accountName: true } },
      },
    });

    if (!supplier || supplier.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Supplier not found');
    }

    return NextResponse.json(supplier);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { id } = await params;
    const body: UpdateSupplierInput = await request.json();

    const supplier = await db.supplier.findUnique({
      where: { id: Number(id) },
    });

    if (!supplier || supplier.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Supplier not found');
    }

    if (body.apAccountId !== undefined) {
      const roleError = requireRole(auth, CAN_LINK_AP_ACCOUNT);
      if (roleError) return roleError;
      await validateApAccount(auth.companyId, body.apAccountId);
    }

    const updated = await db.supplier.update({
      where: { id: Number(id) },
      data: {
        name: body.name,
        contactPerson: body.contactPerson,
        phone: body.phone,
        email: body.email,
        address: body.address,
        isActive: body.isActive,
        apAccountId: body.apAccountId,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
