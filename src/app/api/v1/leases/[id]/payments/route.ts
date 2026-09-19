import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';

const CAN_RECORD_LEASE_PAYMENT = ['ADMIN', 'MANAGER'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_RECORD_LEASE_PAYMENT);
    if (roleError) return roleError;

    const { id } = await params;
    const body = await request.json();
    const periodId = Number(body.periodId);
    const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date();

    if (!periodId) {
      throw new PharmacyServiceError('periodId is required');
    }

    const result = await db.$transaction(async (tx) => {
      const lease = await tx.lease.findUnique({
        where: { id },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!lease) {
        throw new PharmacyServiceError('Lease not found');
      }
      if (!(await canAccessBranch(tx, auth, lease.branchId))) {
        throw new PharmacyServiceError("You do not have access to this branch's data");
      }
      if (lease.status !== 'ACTIVE') {
        throw new PharmacyServiceError(`Cannot record a payment for a lease with status ${lease.status}`);
      }

      const period = await tx.accountingPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        throw new PharmacyServiceError('Accounting period not found');
      }
      await assertPeriodOpenForDate(tx, period.startDate);

      const existingForPeriod = await tx.leasePayment.findUnique({
        where: { leaseId_periodId: { leaseId: id, periodId } },
      });
      if (existingForPeriod) {
        throw new PharmacyServiceError('A payment has already been recorded for this lease in this period');
      }

      // Recording a lease payment IS the whole point of this action — same
      // reasoning as fixed-asset depreciation: fails loudly rather than
      // silently skipping if the required accounts aren't configured.
      if (!lease.rouAssetAccountId || !lease.leaseLiabilityAccountId) {
        throw new PharmacyServiceError(
          'This lease is missing its right-of-use asset and/or lease liability account — set both when editing the lease before recording a payment'
        );
      }

      const [cashMapping, interestMapping, amortizationMapping, baseCurrency] = await Promise.all([
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'CASH' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'INTEREST_EXPENSE' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'AMORTIZATION_EXPENSE' } } }),
        tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
      ]);
      if (!cashMapping || !interestMapping || !amortizationMapping || !baseCurrency) {
        throw new PharmacyServiceError(
          'CASH, INTEREST_EXPENSE, and AMORTIZATION_EXPENSE must all be mapped in Settings → GL Mappings before recording lease payments'
        );
      }

      // IFRS 16 amortized-cost method: each payment first covers interest
      // that's accrued on the outstanding liability since the last payment,
      // with the remainder reducing the principal.
      const previousLiability = lease.payments[0]?.remainingLiability ?? lease.leaseLiability;
      const monthlyRate = lease.discountRate / 100 / 12;
      const interestExpense = Math.min(lease.monthlyPayment, previousLiability * monthlyRate);
      const principalReduction = lease.monthlyPayment - interestExpense;
      const remainingLiability = Math.max(0, previousLiability - principalReduction);

      // Straight-line ROU amortization over the full lease term.
      const totalMonths = Math.max(
        1,
        Math.round((lease.endDate.getTime() - lease.startDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000))
      );
      const rouAmortization = lease.rouAssetValue / totalMonths;

      const entryNumber = await generateEntryNumber();
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          branchId: lease.branchId,
          entryDate: paymentDate,
          description: `Lease payment — ${lease.description} (${lease.leaseCode})`,
          sourceType: 'LEASE_PAYMENT',
          sourceId: lease.id,
          currencyId: baseCurrency.id,
          postedByUserId: auth.userId,
          lines: {
            createMany: {
              data: [
                { accountId: interestMapping.accountId, debit: interestExpense, credit: 0, description: `Lease interest — ${lease.leaseCode}` },
                { accountId: lease.leaseLiabilityAccountId, debit: principalReduction, credit: 0, description: `Lease liability reduction — ${lease.leaseCode}` },
                { accountId: cashMapping.accountId, debit: 0, credit: lease.monthlyPayment, description: `Lease payment — ${lease.leaseCode}` },
                { accountId: amortizationMapping.accountId, debit: rouAmortization, credit: 0, description: `ROU asset amortization — ${lease.leaseCode}` },
                { accountId: lease.rouAssetAccountId, debit: 0, credit: rouAmortization, description: `ROU asset amortization — ${lease.leaseCode}` },
              ],
            },
          },
        },
      });

      const leasePayment = await tx.leasePayment.create({
        data: {
          leaseId: id,
          periodId,
          paymentDate,
          paymentAmount: lease.monthlyPayment,
          interestExpense,
          principalReduction,
          remainingLiability,
          rouAmortization,
          journalEntryId: entry.id,
        },
      });

      if (remainingLiability <= 0.01 || paymentDate >= lease.endDate) {
        await tx.lease.update({ where: { id }, data: { status: 'EXPIRED' } });
      }

      return { leasePayment, journalEntryId: entry.id, remainingLiability };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
