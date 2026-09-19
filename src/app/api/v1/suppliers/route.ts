import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import type { CreateSupplierInput } from '@/types/pharmacy';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';

// Creating/editing suppliers is open to any authenticated staff member
// (routine catalog maintenance), but linking one to a specific AP account
// is a GL-configuration decision — same tier as GL Mappings — so that one
// field is validated and gated separately below, not the whole route.
const CAN_LINK_AP_ACCOUNT = ['ADMIN', 'MANAGER'];

async function validateApAccount(companyId: string, apAccountId: number | undefined) {
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

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const includeInactive = request.nextUrl.searchParams.get('includeInactive') === 'true';

    const suppliers = await db.supplier.findMany({
      where: includeInactive ? { companyId: auth.companyId } : { companyId: auth.companyId, isActive: true },
      include: {
        batches: { take: 1 },
        apAccount: { select: { id: true, accountCode: true, accountName: true } },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(suppliers);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const body: CreateSupplierInput = await request.json();

    if (!body.name || !body.phone) {
      throw new PharmacyServiceError('name and phone are required');
    }

    if (body.apAccountId != null) {
      const roleError = requireRole(auth, CAN_LINK_AP_ACCOUNT);
      if (roleError) return roleError;
      await validateApAccount(auth.companyId, body.apAccountId);
    }

    const supplier = await db.supplier.create({
      data: {
        companyId: auth.companyId,
        name: body.name,
        contactPerson: body.contactPerson,
        phone: body.phone,
        email: body.email,
        address: body.address,
        apAccountId: body.apAccountId,
      },
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
