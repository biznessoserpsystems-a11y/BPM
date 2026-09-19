import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';

const CAN_RUN_DEPRECIATION = ['ADMIN', 'MANAGER'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_RUN_DEPRECIATION);
    if (roleError) return roleError;

    const { id } = await params;
    const body = await request.json();
    const periodId = Number(body.periodId);

    if (!periodId) {
      throw new PharmacyServiceError('periodId is required');
    }

    const result = await db.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findUnique({
        where: { id },
        include: { depreciationEntries: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!asset) {
        throw new PharmacyServiceError('Fixed asset not found');
      }
      if (!(await canAccessBranch(tx, auth, asset.branchId))) {
        throw new PharmacyServiceError("You do not have access to this branch's data");
      }
      if (asset.status !== 'ACTIVE') {
        throw new PharmacyServiceError(`Cannot depreciate an asset with status ${asset.status}`);
      }

      const period = await tx.accountingPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        throw new PharmacyServiceError('Accounting period not found');
      }
      await assertPeriodOpenForDate(tx, period.startDate);

      const existingForPeriod = await tx.depreciationEntry.findUnique({
        where: { assetId_periodId: { assetId: id, periodId } },
      });
      if (existingForPeriod) {
        throw new PharmacyServiceError('This asset has already been depreciated for this period');
      }

      // Depreciating a fixed asset IS the whole point of this action — unlike
      // a sale, there's no separate physical event to protect if the GL
      // mappings are missing, so (unlike sales/goods-receipts/stock
      // adjustments) this fails loudly instead of silently skipping.
      if (!asset.accumulatedDepreciationAccountId || !asset.depreciationExpenseAccountId) {
        throw new PharmacyServiceError(
          'This asset is missing its accumulated depreciation and/or depreciation expense account — set both when editing the asset before running depreciation'
        );
      }

      const previousNbv = asset.depreciationEntries[0]?.netBookValue ?? asset.acquisitionCost;
      const depreciableBase = asset.acquisitionCost - asset.residualValue;
      const remainingDepreciable = Math.max(0, previousNbv - asset.residualValue);

      let depreciationAmount: number;
      if (asset.depreciationMethod === 'REDUCING_BALANCE') {
        // Double-declining-balance rate derived from useful life, since the
        // schema doesn't carry a separate explicit rate field.
        const rate = 2 / asset.usefulLifeMonths;
        depreciationAmount = Math.min(remainingDepreciable, previousNbv * rate);
      } else {
        // STRAIGHT_LINE (default)
        depreciationAmount = Math.min(remainingDepreciable, depreciableBase / asset.usefulLifeMonths);
      }

      if (depreciationAmount <= 0) {
        throw new PharmacyServiceError('This asset is already fully depreciated to its residual value');
      }

      const netBookValue = previousNbv - depreciationAmount;
      const nowFullyDepreciated = netBookValue <= asset.residualValue + 0.01;

      const baseCurrency = await tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } });
      if (!baseCurrency) {
        throw new PharmacyServiceError('No base currency configured — set one in Settings → Currencies first');
      }

      const entryNumber = await generateEntryNumber();
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          branchId: asset.branchId,
          entryDate: period.startDate,
          description: `Depreciation — ${asset.assetName} (${asset.assetCode})`,
          sourceType: 'DEPRECIATION',
          sourceId: asset.id,
          currencyId: baseCurrency.id,
          postedByUserId: auth.userId,
          lines: {
            createMany: {
              data: [
                { accountId: asset.depreciationExpenseAccountId, debit: depreciationAmount, credit: 0, description: `Depreciation expense — ${asset.assetCode}` },
                { accountId: asset.accumulatedDepreciationAccountId, debit: 0, credit: depreciationAmount, description: `Accumulated depreciation — ${asset.assetCode}` },
              ],
            },
          },
        },
      });

      const depreciationEntry = await tx.depreciationEntry.create({
        data: {
          assetId: id,
          periodId,
          depreciationAmount,
          netBookValue,
          journalEntryId: entry.id,
        },
      });

      if (nowFullyDepreciated) {
        await tx.fixedAsset.update({ where: { id }, data: { status: 'FULLY_DEPRECIATED' } });
      }

      return { depreciationEntry, journalEntryId: entry.id, netBookValue, nowFullyDepreciated };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
