import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import type { CreateCurrencyInput } from '@/types/pharmacy';

// Same tier as Chart of Accounts, GL mappings, and base-currency changes —
// adding a currency is a financial-configuration change, not a day-to-day
// operational action.
const CAN_MANAGE_CURRENCIES = ['ADMIN', 'MANAGER'];

// GHS (Ghanaian Cedi) is this system's permanently fixed base currency.
// See /api/v1/currencies/[id]/set-base for the write-side lock. This
// constant is duplicated there rather than imported to keep each route
// self-contained (Next.js route modules are otherwise independent).
const LOCKED_BASE_CURRENCY_CODE = 'GHS';

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    let currencies = await db.currency.findMany({
      where: { companyId: auth.companyId },
      orderBy: [{ isBaseCurrency: 'desc' }, { code: 'asc' }],
    });

    // Self-healing invariant: if the DB was ever left with a non-GHS base
    // (e.g. data from before this lock was added), correct it on read so
    // "GHS is always the base currency" holds even for pre-existing data,
    // not just currencies changed through this app going forward. Scoped
    // to this company only — without the companyId filters here, this
    // would silently rewrite every other company's base-currency flag too.
    const currentBase = currencies.find((c) => c.isBaseCurrency);
    if (!currentBase || currentBase.code !== LOCKED_BASE_CURRENCY_CODE) {
      const ghs = currencies.find((c) => c.code === LOCKED_BASE_CURRENCY_CODE);
      if (ghs) {
        await db.$transaction([
          db.currency.updateMany({ where: { companyId: auth.companyId, isBaseCurrency: true }, data: { isBaseCurrency: false } }),
          db.currency.update({ where: { id: ghs.id }, data: { isBaseCurrency: true } }),
        ]);
        currencies = await db.currency.findMany({
          where: { companyId: auth.companyId },
          orderBy: [{ isBaseCurrency: 'desc' }, { code: 'asc' }],
        });
      }
    }

    return NextResponse.json(currencies);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_CURRENCIES);
    if (roleError) return roleError;

    const body: CreateCurrencyInput = await request.json();

    if (!body.code || !body.name || !body.symbol) {
      throw new PharmacyServiceError('code, name, and symbol are required');
    }

    const existing = await db.currency.findUnique({
      where: { companyId_code: { companyId: auth.companyId, code: body.code.toUpperCase() } },
    });
    if (existing) {
      throw new PharmacyServiceError(`Currency "${body.code}" already exists`);
    }

    const currency = await db.currency.create({
      data: {
        companyId: auth.companyId,
        code: body.code.toUpperCase(),
        name: body.name,
        symbol: body.symbol,
        decimalPlaces: body.decimalPlaces ?? 2,
      },
    });

    return NextResponse.json(currency, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
