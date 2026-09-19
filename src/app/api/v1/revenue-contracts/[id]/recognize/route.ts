import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';

const CAN_RECOGNIZE_REVENUE = ['ADMIN', 'MANAGER'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_RECOGNIZE_REVENUE);
    if (roleError) return roleError;

    const { id } = await params;
    const body = await request.json();
    const periodId = Number(body.periodId);
    const recognizedAmount = Number(body.recognizedAmount);

    if (!periodId || !recognizedAmount || recognizedAmount <= 0) {
      throw new PharmacyServiceError('periodId and a positive recognizedAmount are required');
    }

    const result = await db.$transaction(async (tx) => {
      const contract = await tx.revenueContract.findUnique({ where: { id } });
      if (!contract) {
        throw new PharmacyServiceError('Revenue contract not found');
      }
      if (!(await canAccessBranch(tx, auth, contract.branchId))) {
        throw new PharmacyServiceError("You do not have access to this branch's data");
      }
      if (contract.status !== 'ACTIVE') {
        throw new PharmacyServiceError(`Cannot recognize revenue on a contract with status ${contract.status}`);
      }
      if (recognizedAmount > contract.deferredRevenue + 0.01) {
        throw new PharmacyServiceError(
          `Cannot recognize ${recognizedAmount} — only ${contract.deferredRevenue} remains deferred on this contract`
        );
      }

      const period = await tx.accountingPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        throw new PharmacyServiceError('Accounting period not found');
      }
      await assertPeriodOpenForDate(tx, period.startDate);

      const existingForPeriod = await tx.revenueRecognitionEntry.findUnique({
        where: { contractId_periodId: { contractId: id, periodId } },
      });
      if (existingForPeriod) {
        throw new PharmacyServiceError('Revenue has already been recognized for this contract in this period');
      }

      // Recognizing revenue IS the whole point of this action — same
      // reasoning as fixed-asset depreciation and lease payments.
      if (!contract.deferredRevenueAccountId) {
        throw new PharmacyServiceError(
          'This contract is missing its deferred revenue account — set one when editing the contract before recognizing revenue'
        );
      }

      const [revenueMapping, baseCurrency] = await Promise.all([
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SALES_REVENUE' } } }),
        tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
      ]);
      if (!revenueMapping || !baseCurrency) {
        throw new PharmacyServiceError('SALES_REVENUE must be mapped in Settings → GL Mappings before recognizing revenue');
      }

      const newRecognizedRevenue = contract.recognizedRevenue + recognizedAmount;
      const newDeferredRevenue = contract.deferredRevenue - recognizedAmount;
      const nowComplete = newDeferredRevenue <= 0.01;

      const entryNumber = await generateEntryNumber();
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          branchId: contract.branchId,
          entryDate: period.startDate,
          description: `Revenue recognition — ${contract.customerName} (${contract.contractCode})`,
          sourceType: 'REVENUE_RECOGNITION',
          sourceId: contract.id,
          currencyId: baseCurrency.id,
          postedByUserId: auth.userId,
          lines: {
            createMany: {
              data: [
                { accountId: contract.deferredRevenueAccountId, debit: recognizedAmount, credit: 0, description: `Deferred revenue drawn down — ${contract.contractCode}` },
                { accountId: revenueMapping.accountId, debit: 0, credit: recognizedAmount, description: `Revenue recognized — ${contract.contractCode}` },
              ],
            },
          },
        },
      });

      const recognitionEntry = await tx.revenueRecognitionEntry.create({
        data: {
          contractId: id,
          periodId,
          recognizedAmount,
          journalEntryId: entry.id,
        },
      });

      await tx.revenueContract.update({
        where: { id },
        data: {
          recognizedRevenue: newRecognizedRevenue,
          deferredRevenue: newDeferredRevenue,
          status: nowComplete ? 'COMPLETED' : undefined,
        },
      });

      return { recognitionEntry, journalEntryId: entry.id, deferredRevenue: newDeferredRevenue, nowComplete };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
