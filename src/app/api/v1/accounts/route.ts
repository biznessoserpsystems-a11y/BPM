import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import type { CreateAccountInput } from '@/types/pharmacy';

const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const VALID_BALANCES = ['DEBIT', 'CREDIT'];

// Chart of Accounts structure is foundational accounting config, same
// tier as approval-rules and settings/backup — ADMIN only.
const CAN_MANAGE_CHART_OF_ACCOUNTS = ['ADMIN'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const accounts = await db.account.findMany({
      where: { companyId: auth.companyId },
      orderBy: { accountCode: 'asc' },
      include: { parentAccount: { select: { accountCode: true, accountName: true } } },
    });

    return NextResponse.json(accounts);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    if (!CAN_MANAGE_CHART_OF_ACCOUNTS.includes(auth.roleName)) {
      throw new PharmacyServiceError(
        `Only ${CAN_MANAGE_CHART_OF_ACCOUNTS.join(' or ')} may create Chart of Accounts entries (your role: ${auth.roleName})`
      );
    }

    const body: CreateAccountInput = await request.json();

    if (!body.accountCode || !body.accountName || !body.accountType || !body.normalBalance) {
      throw new PharmacyServiceError('accountCode, accountName, accountType, and normalBalance are required');
    }
    if (!VALID_TYPES.includes(body.accountType)) {
      throw new PharmacyServiceError(`accountType must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (!VALID_BALANCES.includes(body.normalBalance)) {
      throw new PharmacyServiceError(`normalBalance must be one of: ${VALID_BALANCES.join(', ')}`);
    }

    const existing = await db.account.findUnique({
      where: { companyId_accountCode: { companyId: auth.companyId, accountCode: body.accountCode } },
    });
    if (existing) {
      throw new PharmacyServiceError(`Account code "${body.accountCode}" already exists`);
    }

    // parentAccountId, if given, must belong to this same company — without
    // this check, one company could point its hierarchy at (and, via the
    // included parentAccount fields elsewhere, read the code/name of)
    // another company's account row by guessing its numeric id.
    if (body.parentAccountId) {
      const parent = await db.account.findUnique({ where: { id: body.parentAccountId } });
      if (!parent || parent.companyId !== auth.companyId) {
        throw new PharmacyServiceError('parentAccountId does not belong to your company');
      }
    }

    const account = await db.account.create({
      data: {
        companyId: auth.companyId,
        accountCode: body.accountCode,
        accountName: body.accountName,
        accountType: body.accountType,
        accountSubType: body.accountSubType,
        normalBalance: body.normalBalance,
        parentAccountId: body.parentAccountId,
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
