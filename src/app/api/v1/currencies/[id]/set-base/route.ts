import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError } from '@/lib/auth';

// Changing the base currency ripples through every FX conversion in the
// system — same tier as Chart of Accounts and approval-rules — ADMIN only.
const CAN_SET_BASE_CURRENCY = ['ADMIN'];

// GHS (Ghanaian Cedi) is this system's fixed base currency — it should
// never be switched away from, even by an Admin. Other currencies remain
// active/usable for FX conversion and multi-currency display, they just
// can't become the base.
const LOCKED_BASE_CURRENCY_CODE = 'GHS';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    if (!CAN_SET_BASE_CURRENCY.includes(auth.roleName)) {
      throw new PharmacyServiceError(
        `Only ${CAN_SET_BASE_CURRENCY.join(' or ')} may change the base currency (your role: ${auth.roleName})`
      );
    }

    const { id } = await params;
    const currencyId = Number(id);

    const target = await db.currency.findUnique({ where: { id: currencyId } });
    if (!target || target.companyId !== auth.companyId) {
      throw new PharmacyServiceError(`Currency ${id} not found`);
    }
    if (target.code !== LOCKED_BASE_CURRENCY_CODE) {
      throw new PharmacyServiceError(
        `The base currency is fixed to ${LOCKED_BASE_CURRENCY_CODE} (Ghanaian Cedi) and cannot be changed to ${target.code}.`
      );
    }

    // Exactly one currency may be the base at a time — unset the old one
    // and set the new one inside a single transaction. Scoped to this
    // company's own currencies only, so this can never unset another
    // company's base currency.
    const [, updated] = await db.$transaction([
      db.currency.updateMany({
        where: { companyId: auth.companyId, isBaseCurrency: true },
        data: { isBaseCurrency: false },
      }),
      db.currency.update({
        where: { id: currencyId },
        data: { isBaseCurrency: true },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
