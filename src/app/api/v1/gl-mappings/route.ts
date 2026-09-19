import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { SetGLMappingInput } from '@/types/pharmacy';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const mappings = await db.gLAccountMapping.findMany({
      where: { companyId: auth.companyId },
      include: { account: { select: { accountCode: true, accountName: true, accountType: true } } },
      orderBy: { mappingKey: 'asc' },
    });

    return NextResponse.json(mappings);
  } catch (error) {
    return handleApiError(error);
  }
}

// Controls where automated postings land in the ledger, so this is
// deliberately restricted rather than open to every authenticated user.
const CAN_MANAGE_MAPPINGS = ['ADMIN', 'MANAGER'];

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_MAPPINGS);
    if (roleError) return roleError;

    const body: SetGLMappingInput = await request.json();

    if (!body.mappingKey || !body.accountId) {
      throw new PharmacyServiceError('mappingKey and accountId are required');
    }

    const account = await db.account.findUnique({ where: { id: body.accountId } });
    if (!account || account.companyId !== auth.companyId) {
      throw new PharmacyServiceError(`Account ${body.accountId} not found`);
    }

    const mapping = await db.gLAccountMapping.upsert({
      where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: body.mappingKey } },
      update: { accountId: body.accountId },
      create: { companyId: auth.companyId, mappingKey: body.mappingKey, accountId: body.accountId },
      include: { account: { select: { accountCode: true, accountName: true, accountType: true } } },
    });

    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
