import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { assertPeriodOpenForDate } from '@/lib/accounting-period';
import { generateEntryNumber } from '@/lib/journal-entry-number';
import { generatePayRunNumber } from '@/lib/pay-run-number';
import { calculatePayslip, type TaxBand } from '@/lib/payroll-calc';
import type { CreatePayRunInput } from '@/types/pharmacy';

const CAN_PROCESS_PAYROLL = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_PROCESS_PAYROLL);
    if (roleError) return roleError;

    const runs = await db.payRun.findMany({
      where: { companyId: auth.companyId },
      orderBy: { payDate: 'desc' },
      include: { processedByUser: { select: { id: true, fullName: true } } },
    });

    return NextResponse.json(runs);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_PROCESS_PAYROLL);
    if (roleError) return roleError;

    const body: CreatePayRunInput = await request.json();
    if (!body.periodStart || !body.periodEnd || !body.payDate) {
      throw new PharmacyServiceError('periodStart, periodEnd, and payDate are required');
    }
    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    const payDate = new Date(body.payDate);
    if (periodStart > periodEnd) {
      throw new PharmacyServiceError('periodStart must be before periodEnd');
    }

    const result = await db.$transaction(async (tx) => {
      await assertPeriodOpenForDate(tx, payDate);

      const employees = await tx.employee.findMany({
        where: { companyId: auth.companyId, isActive: true },
      });
      if (employees.length === 0) {
        throw new PharmacyServiceError('No active employees to run payroll for');
      }

      const bandRows = await tx.payeTaxBand.findMany({ where: { companyId: auth.companyId } });
      if (bandRows.length === 0) {
        throw new PharmacyServiceError(
          'No PAYE tax bands configured — set them up in Settings → Payroll before running payroll'
        );
      }
      const bands: TaxBand[] = bandRows.map((b) => ({ minAmount: b.minAmount, maxAmount: b.maxAmount, ratePct: b.ratePct }));

      const settings = await tx.payrollSettings.findUnique({ where: { companyId: auth.companyId } });
      const ssnitEmployeePct = settings?.ssnitEmployeePct ?? 5.5;
      const ssnitEmployerPct = settings?.ssnitEmployerPct ?? 13;
      const ssnitCeiling = settings?.ssnitCeiling ?? null;

      const adjustmentsByEmployee = new Map(
        (body.employeeAdjustments ?? []).map((a) => [a.employeeId, a.otherDeductions ?? 0])
      );

      // Processing payroll IS the whole point of this action — same
      // reasoning as depreciation, lease payments, and revenue
      // recognition: fails loudly rather than silently skipping if the
      // required accounts aren't configured, since there's no separate
      // physical event to protect.
      const [salaryMapping, payeMapping, ssnitMapping, ssnitEmployerMapping, cashMapping, baseCurrency] = await Promise.all([
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SALARY_EXPENSE' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'PAYE_PAYABLE' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SSNIT_PAYABLE' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'SSNIT_EMPLOYER_EXPENSE' } } }),
        tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'CASH' } } }),
        tx.currency.findFirst({ where: { companyId: auth.companyId, isBaseCurrency: true } }),
      ]);
      const missing = [
        !salaryMapping && 'SALARY_EXPENSE',
        !payeMapping && 'PAYE_PAYABLE',
        !ssnitMapping && 'SSNIT_PAYABLE',
        !ssnitEmployerMapping && 'SSNIT_EMPLOYER_EXPENSE',
        !cashMapping && 'CASH',
      ].filter(Boolean);
      if (missing.length > 0) {
        throw new PharmacyServiceError(`Map these GL keys in Settings → GL Mappings before running payroll: ${missing.join(', ')}`);
      }
      if (!baseCurrency) {
        throw new PharmacyServiceError('No base currency configured — set one in Settings → Currencies first');
      }

      let totalGross = 0, totalPaye = 0, totalSsnitEmployee = 0, totalSsnitEmployer = 0, totalNet = 0, totalOtherDeductions = 0;
      const lineData: {
        employeeId: string; basicSalary: number; allowances: number; grossPay: number;
        ssnitEmployee: number; ssnitEmployer: number; payeTax: number; otherDeductions: number; netPay: number;
      }[] = [];

      for (const emp of employees) {
        const otherDeductions = adjustmentsByEmployee.get(emp.id) ?? 0;
        const calc = calculatePayslip(emp.basicSalary, emp.allowances, otherDeductions, bands, ssnitEmployeePct, ssnitEmployerPct, ssnitCeiling);

        totalGross += calc.grossPay;
        totalPaye += calc.payeTax;
        totalSsnitEmployee += calc.ssnitEmployee;
        totalSsnitEmployer += calc.ssnitEmployer;
        totalOtherDeductions += otherDeductions;
        totalNet += calc.netPay;

        lineData.push({
          employeeId: emp.id,
          basicSalary: emp.basicSalary,
          allowances: emp.allowances,
          grossPay: calc.grossPay,
          ssnitEmployee: calc.ssnitEmployee,
          ssnitEmployer: calc.ssnitEmployer,
          payeTax: calc.payeTax,
          otherDeductions,
          netPay: calc.netPay,
        });
      }

      // Other-deductions payable is only relevant (and only mapped) if
      // this run actually has any — most companies never will. Optional,
      // same conditional-line pattern as Sales Returns' restocking lines,
      // and required for the entry to balance whenever it IS used.
      let otherDeductionsMapping: Awaited<ReturnType<typeof tx.gLAccountMapping.findUnique>> = null;
      if (totalOtherDeductions > 0) {
        otherDeductionsMapping = await tx.gLAccountMapping.findUnique({ where: { companyId_mappingKey: { companyId: auth.companyId, mappingKey: 'OTHER_DEDUCTIONS_PAYABLE' } } });
        if (!otherDeductionsMapping) {
          throw new PharmacyServiceError('OTHER_DEDUCTIONS_PAYABLE must be mapped — this run includes employee deductions beyond PAYE/SSNIT');
        }
      }

      const lines = [
        { accountId: salaryMapping!.accountId, debit: totalGross, credit: 0, description: 'Salary expense' },
        { accountId: ssnitEmployerMapping!.accountId, debit: totalSsnitEmployer, credit: 0, description: 'Employer SSNIT contribution' },
        { accountId: payeMapping!.accountId, debit: 0, credit: totalPaye, description: 'PAYE withheld' },
        { accountId: ssnitMapping!.accountId, debit: 0, credit: totalSsnitEmployee + totalSsnitEmployer, description: 'SSNIT payable (employee + employer)' },
        { accountId: cashMapping!.accountId, debit: 0, credit: totalNet, description: 'Net pay to employees' },
      ];
      if (totalOtherDeductions > 0 && otherDeductionsMapping) {
        lines.push({ accountId: otherDeductionsMapping.accountId, debit: 0, credit: totalOtherDeductions, description: 'Other deductions payable' });
      }

      const entryNumber = await generateEntryNumber();
      const runNumber = await generatePayRunNumber();

      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          branchId: body.branchId ?? auth.homeBranchId,
          entryDate: payDate,
          description: `Payroll — ${runNumber} (${periodStart.toLocaleDateString()} to ${periodEnd.toLocaleDateString()})`,
          sourceType: 'PAYROLL',
          sourceId: null,
          currencyId: baseCurrency.id,
          postedByUserId: auth.userId,
          lines: { createMany: { data: lines } },
        },
      });

      const payRun = await tx.payRun.create({
        data: {
          companyId: auth.companyId,
          branchId: body.branchId,
          runNumber,
          periodStart,
          periodEnd,
          payDate,
          status: 'POSTED',
          totalGross,
          totalPaye,
          totalSsnitEmployee,
          totalSsnitEmployer,
          totalNet,
          processedByUserId: auth.userId,
          journalEntryId: entry.id,
          lines: { createMany: { data: lineData } },
        },
      });

      return { payRun, journalEntryId: entry.id };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
