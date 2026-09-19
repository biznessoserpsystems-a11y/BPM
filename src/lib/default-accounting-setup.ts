import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Seeds a minimal starter Chart of Accounts, base currency, GL account
 * mappings, and payroll tax configuration (PAYE bands + SSNIT rates) for
 * a brand-new company. Account/Currency/GLAccountMapping/PayeTaxBand/
 * PayrollSettings are all company-scoped (see prisma/schema.prisma's
 * Company doc comment), so a company created via POST
 * /auth/register-company would otherwise start with zero accounts and no
 * payroll tax settings — meaning journal entries, reports, every
 * auto-posting feature (goods receipts, sales, depreciation, ...), and
 * payroll calculations would silently do nothing until an admin manually
 * built all of this from scratch through the UI. This gives every new
 * company the same reasonable starting point, which they're free to edit
 * or extend afterward (see Settings → GL Mappings and Payroll → Tax &
 * SSNIT Settings).
 */
export async function seedStarterAccounting(tx: Tx, companyId: string): Promise<void> {
  await tx.currency.create({
    data: {
      companyId,
      code: 'GHS',
      name: 'Ghanaian Cedi',
      symbol: 'GH₵',
      decimalPlaces: 2,
      isBaseCurrency: true,
    },
  });

  const starterAccounts = [
    { accountCode: '1000', accountName: 'Cash', accountType: 'ASSET', accountSubType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { accountCode: '1100', accountName: 'Accounts Receivable', accountType: 'ASSET', accountSubType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { accountCode: '1200', accountName: 'Inventory', accountType: 'ASSET', accountSubType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { accountCode: '2000', accountName: 'Accounts Payable', accountType: 'LIABILITY', accountSubType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { accountCode: '2100', accountName: 'Tax Payable', accountType: 'LIABILITY', accountSubType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { accountCode: '3000', accountName: "Owner's Equity", accountType: 'EQUITY', normalBalance: 'CREDIT' },
    { accountCode: '4000', accountName: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT' },
    { accountCode: '5000', accountName: 'Cost of Goods Sold', accountType: 'EXPENSE', accountSubType: 'COGS', normalBalance: 'DEBIT' },
    { accountCode: '5100', accountName: 'Inventory Write-Down', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
    { accountCode: '5200', accountName: 'General & Administrative Expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  ];

  const accountByCode = new Map<string, number>();
  for (const acct of starterAccounts) {
    const created = await tx.account.create({ data: { companyId, ...acct } });
    accountByCode.set(acct.accountCode, created.id);
  }

  const starterMappings: [string, string][] = [
    ['CASH', '1000'],
    ['AR', '1100'],
    ['INVENTORY_ASSET', '1200'],
    ['AP', '2000'],
    ['TAX_PAYABLE', '2100'],
    ['SALES_REVENUE', '4000'],
    ['COGS', '5000'],
    ['INVENTORY_WRITE_DOWN', '5100'],
  ];
  for (const [mappingKey, accountCode] of starterMappings) {
    await tx.gLAccountMapping.create({
      data: { companyId, mappingKey, accountId: accountByCode.get(accountCode)! },
    });
  }

  // PAYE tax bands — sourced directly from GRA's own official page
  // (gra.gov.gh/domestic-tax/tax-types/paye/), effective since January 1,
  // 2024 and confirmed still current as of this writing. Still just a
  // starting point, not a guarantee of permanent accuracy — GRA can and
  // does update these; see the in-app warning in Payroll → Tax & SSNIT
  // Settings and the direct link to GRA's page there.
  //
  // One real subtlety worth documenting: GRA's own published table has a
  // small internal inconsistency — its "Cumulative Income" column sums to
  // exactly 50,416.67 through the 30% band (490+110+130+3,166.67+
  // 16,000+30,520), but the final row's own label separately says
  // "Exceeding 50,000.00". This uses the internally consistent cumulative
  // figure (50,416.67) as the boundary, not the rounded "50,000" label —
  // the same resolution independent tax-law commentary uses for this
  // exact same known ambiguity.
  const payeBands = [
    { minAmount: 0, maxAmount: 490, ratePct: 0 },
    { minAmount: 490, maxAmount: 600, ratePct: 5 },
    { minAmount: 600, maxAmount: 730, ratePct: 10 },
    { minAmount: 730, maxAmount: 3896.67, ratePct: 17.5 },
    { minAmount: 3896.67, maxAmount: 19896.67, ratePct: 25 },
    { minAmount: 19896.67, maxAmount: 50416.67, ratePct: 30 },
    { minAmount: 50416.67, maxAmount: null, ratePct: 35 },
  ];
  for (let i = 0; i < payeBands.length; i++) {
    await tx.payeTaxBand.create({
      data: { companyId, sortOrder: i, ...payeBands[i] },
    });
  }

  // SSNIT — 5.5% employee is stated directly on GRA's own PAYE page (as a
  // PAYE-deductible item); 13% employer is the consistently-cited
  // standard Tier 1 employer contribution from independent sources, not
  // itself confirmed on that specific GRA page — worth a closer look if
  // this matters for real payroll.
  await tx.payrollSettings.create({
    data: { companyId, ssnitEmployeePct: 5.5, ssnitEmployerPct: 13 },
  });
}
