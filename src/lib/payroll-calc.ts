/**
 * Ghana statutory payroll calculations. Pure functions, no I/O — the
 * actual tax bands and rates always come from the database (company-
 * configurable, see PayeTaxBand/PayrollSettings in schema.prisma), never
 * hardcoded here.
 *
 * Deliberate scope boundary: this implements straightforward MONTHLY
 * (period) PAYE — each month's tax is computed independently by running
 * that month's chargeable income through the bands. Ghana's PAYE is
 * technically a cumulative year-to-date system (GRA's own guidance
 * describes summing income across the fiscal year so far and applying
 * bands to the running total), which self-corrects for bonuses, raises,
 * or an employee starting mid-year. For a stable, level monthly salary —
 * the common case — period and cumulative methods produce identical
 * results. They diverge for irregular income (bonuses, mid-year raises,
 * back pay). Building full YTD-cumulative tracking per employee across
 * the fiscal year is real, substantial additional work not included
 * here — treat this as correct for steady monthly pay, not a complete
 * replacement for a qualified payroll accountant's review on irregular
 * income months.
 */

export interface TaxBand {
  minAmount: number;
  maxAmount: number | null; // null = "and above", the top band
  ratePct: number; // 5 means 5%, not 0.05
}

/**
 * Applies each band only to the slice of income that falls within it —
 * the standard progressive/marginal calculation, not a flat rate on the
 * whole amount.
 */
export function calculatePaye(chargeableIncome: number, bands: TaxBand[]): number {
  if (chargeableIncome <= 0 || bands.length === 0) return 0;

  const sorted = [...bands].sort((a, b) => a.minAmount - b.minAmount);
  let tax = 0;

  for (const band of sorted) {
    if (chargeableIncome <= band.minAmount) break;
    const bandTop = band.maxAmount === null ? chargeableIncome : Math.min(band.maxAmount, chargeableIncome);
    const amountInBand = bandTop - band.minAmount;
    if (amountInBand > 0) {
      tax += amountInBand * (band.ratePct / 100);
    }
  }

  return Math.round(tax * 100) / 100;
}

export interface SsnitResult {
  employeeContribution: number;
  employerContribution: number;
  insurableEarnings: number; // basic salary, capped at the ceiling if one is set
}

/**
 * SSNIT is calculated on basic salary only (not allowances), capped at
 * the insurable earnings ceiling if the company has one configured.
 */
export function calculateSsnit(
  basicSalary: number,
  employeeRatePct: number,
  employerRatePct: number,
  ceiling: number | null
): SsnitResult {
  const insurableEarnings = ceiling !== null ? Math.min(basicSalary, ceiling) : basicSalary;
  return {
    employeeContribution: Math.round(insurableEarnings * (employeeRatePct / 100) * 100) / 100,
    employerContribution: Math.round(insurableEarnings * (employerRatePct / 100) * 100) / 100,
    insurableEarnings,
  };
}

export interface PayslipCalculation {
  grossPay: number;
  ssnitEmployee: number;
  ssnitEmployer: number;
  payeTax: number;
  netPay: number;
}

/**
 * The full per-employee calculation for one pay run. PAYE is charged on
 * full gross pay (basic + allowances) — per current GRA guidance, SSNIT
 * employee contributions are a separate deduction and do NOT reduce
 * PAYE-taxable income for standard employees (unlike some other
 * jurisdictions where pension contributions are pre-tax).
 */
export function calculatePayslip(
  basicSalary: number,
  allowances: number,
  otherDeductions: number,
  bands: TaxBand[],
  ssnitEmployeeRatePct: number,
  ssnitEmployerRatePct: number,
  ssnitCeiling: number | null
): PayslipCalculation {
  const grossPay = basicSalary + allowances;
  const ssnit = calculateSsnit(basicSalary, ssnitEmployeeRatePct, ssnitEmployerRatePct, ssnitCeiling);
  const payeTax = calculatePaye(grossPay, bands);
  const netPay = grossPay - ssnit.employeeContribution - payeTax - otherDeductions;

  return {
    grossPay,
    ssnitEmployee: ssnit.employeeContribution,
    ssnitEmployer: ssnit.employerContribution,
    payeTax,
    netPay: Math.round(netPay * 100) / 100,
  };
}
