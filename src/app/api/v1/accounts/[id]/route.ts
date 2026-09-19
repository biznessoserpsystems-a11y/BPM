import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { UpdateAccountInput } from '@/types/pharmacy';

const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const VALID_BALANCES = ['DEBIT', 'CREDIT'];

// Same tier as creating an account.
const CAN_MANAGE_CHART_OF_ACCOUNTS = ['ADMIN'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_CHART_OF_ACCOUNTS);
    if (roleError) return roleError;

    const { id } = await params;
    const accountId = Number(id);
    const body: UpdateAccountInput = await request.json();

    const existing = await db.account.findUnique({ where: { id: accountId } });
    if (!existing || existing.companyId !== auth.companyId) {
      throw new PharmacyServiceError('Account not found');
    }

    if (body.accountType && !VALID_TYPES.includes(body.accountType)) {
      throw new PharmacyServiceError(`accountType must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (body.normalBalance && !VALID_BALANCES.includes(body.normalBalance)) {
      throw new PharmacyServiceError(`normalBalance must be one of: ${VALID_BALANCES.join(', ')}`);
    }

    if (body.accountCode && body.accountCode !== existing.accountCode) {
      const codeInUse = await db.account.findUnique({
        where: { companyId_accountCode: { companyId: auth.companyId, accountCode: body.accountCode } },
      });
      if (codeInUse) {
        throw new PharmacyServiceError(`Account code "${body.accountCode}" already exists`);
      }
    }

    if (body.parentAccountId === accountId) {
      throw new PharmacyServiceError('An account cannot be its own parent');
    }
    if (body.parentAccountId) {
      const parent = await db.account.findUnique({ where: { id: body.parentAccountId } });
      if (!parent || parent.companyId !== auth.companyId) {
        throw new PharmacyServiceError('parentAccountId does not belong to your company');
      }
    }

    // Changing what an account *is* (its type or which side normally
    // increases it) after it already carries real postings would silently
    // reinterpret every past journal line and corrupt historical Income
    // Statements/Balance Sheets — those reports classify purely by the
    // account's current type, with no per-line snapshot of what it was at
    // posting time. Renaming, re-parenting, or deactivating stays safe
    // regardless of history; changing the accounting nature of the account
    // itself is only safe before it's ever been used.
    const changingNature =
      (body.accountType && body.accountType !== existing.accountType) ||
      (body.normalBalance && body.normalBalance !== existing.normalBalance);
    if (changingNature) {
      const lineCount = await db.journalLine.count({ where: { accountId } });
      if (lineCount > 0) {
        throw new PharmacyServiceError(
          `Cannot change the account type or normal balance — this account already has ${lineCount} posted journal line${lineCount > 1 ? 's' : ''}. Deactivate it and create a new account instead.`
        );
      }
    }

    const updated = await db.account.update({
      where: { id: accountId },
      data: {
        accountCode: body.accountCode,
        accountName: body.accountName,
        accountType: body.accountType,
        accountSubType: body.accountSubType,
        normalBalance: body.normalBalance,
        parentAccountId: body.parentAccountId,
        isActive: body.isActive,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
