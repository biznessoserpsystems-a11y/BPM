import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import type { CreateExchangeRateInput } from '@/types/pharmacy';

// Recording/updating official exchange rates is a financial-configuration
// change with the same blast radius as switching currencies or GL mappings
// — restricted to Admin/Manager, same tier used for Currency setup.
const CAN_MANAGE_EXCHANGE_RATES = ['ADMIN', 'MANAGER'];

// Reading rates is open to any authenticated user — Purchase Orders,
// Journal Entries, and reports all need to look these up regardless of
// the requester's role; only recording/editing a rate is gated.
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const { searchParams } = new URL(request.url);
    const currencyId = searchParams.get('currencyId');

    const rates = await db.exchangeRate.findMany({
      where: currencyId
        ? { currencyId: Number(currencyId), currency: { companyId: auth.companyId } }
        : { currency: { companyId: auth.companyId } },
      include: { currency: { select: { code: true, name: true, symbol: true } } },
      orderBy: [{ rateDate: 'desc' }, { currencyId: 'asc' }],
    });

    return NextResponse.json(rates);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_EXCHANGE_RATES);
    if (roleError) return roleError;

    const body: CreateExchangeRateInput = await request.json();

    if (!body.currencyId || !body.rateDate || body.rateToBase === undefined) {
      throw new PharmacyServiceError('currencyId, rateDate, and rateToBase are required');
    }
    if (body.rateToBase <= 0) {
      throw new PharmacyServiceError('rateToBase must be a positive number');
    }

    const currency = await db.currency.findUnique({ where: { id: body.currencyId } });
    if (!currency || currency.companyId !== auth.companyId) {
      throw new PharmacyServiceError(`Currency ${body.currencyId} not found`);
    }
    if (currency.isBaseCurrency) {
      throw new PharmacyServiceError(`${currency.code} is the base currency — it doesn't need an exchange rate against itself.`);
    }

    const rateDate = new Date(body.rateDate);

    // One rate per currency per day — recording the same date again edits
    // the existing entry rather than creating a duplicate, so the "record
    // today's rate" workflow works the same whether it's the first entry
    // of the day or a correction to one already saved.
    const rate = await db.exchangeRate.upsert({
      where: { currencyId_rateDate: { currencyId: body.currencyId, rateDate } },
      update: { rateToBase: body.rateToBase, source: body.source ?? 'MANUAL' },
      create: {
        currencyId: body.currencyId,
        rateDate,
        rateToBase: body.rateToBase,
        source: body.source ?? 'MANUAL',
      },
      include: { currency: { select: { code: true, name: true, symbol: true } } },
    });

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'EXCHANGE_RATE_RECORDED',
      entityName: 'ExchangeRate',
      entityId: String(rate.id),
      details: { currency: currency.code, rateDate: body.rateDate, rateToBase: body.rateToBase },
    });

    return NextResponse.json(rate, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
