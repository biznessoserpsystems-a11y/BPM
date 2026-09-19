'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendingUp, Landmark, Wallet, AlertTriangle, CheckCircle2, Scale, FileClock, Download, BarChart3 } from 'lucide-react';
import { BusinessAnalysisSection } from '@/components/views/business-analysis-section';
import { usePharmacyStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { exportReportToPdf, type PdfSection } from '@/lib/pdf-export';
import { useCompany } from '@/hooks/use-company';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthStartISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// =============================================================================
// TYPES
// =============================================================================

interface AccountLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  amount: number;
}

interface IncomeStatementData {
  startDate: string;
  endDate: string;
  sales: AccountLine[];
  totalSales: number;
  salesReturns: number;
  salesReturnsAccountConfigured: boolean;
  netSales: number;
  cogsAccountConfigured: boolean;
  cogsLines: AccountLine[];
  totalCogs: number;
  grossProfit: number;
  expenses: AccountLine[];
  totalExpenses: number;
  netIncome: number;
}

interface BalanceSheetData {
  asOfDate: string;
  assets: AccountLine[];
  liabilities: AccountLine[];
  equity: AccountLine[];
  retainedEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  difference: number;
}

interface CashFlowData {
  startDate: string;
  endDate: string;
  cashAccount: { accountCode: string; accountName: string };
  beginningBalance: number;
  netChange: number;
  endingBalance: number;
  activity: { sourceType: string; netCashFlow: number }[];
}

interface TrialBalanceLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  debitBalance: number;
  creditBalance: number;
}

interface TrialBalanceData {
  asOfDate: string;
  rows: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  difference: number;
  isBalanced: boolean;
}

interface AgingBucketFields {
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  totalOutstanding: number;
  oldestOutstandingDate: string | null;
}

interface ApAgingRow extends AgingBucketFields {
  supplierId: number;
  supplierName: string;
  usesSharedAccount: boolean;
  totalCharged: number;
  totalPaid: number;
}

interface ArAgingRow extends AgingBucketFields {
  customerName: string;
  totalCharged: number;
  claimCount: number;
}

interface AgingReport<T> {
  asOfDate: string;
  rows: T[];
  totals: AgingBucketFields;
}

// =============================================================================
// PDF EXPORT MAPPERS — each converts a report's fetched data into the
// {columns, rows} shape exportReportToPdf() renders. Amounts are
// pre-formatted with formatMoney so the PDF matches what's on screen
// exactly, rather than relying on generic number formatting.
// =============================================================================

function incomeStatementToPdfSections(data: IncomeStatementData, currency: Parameters<typeof formatMoney>[1]): PdfSection[] {
  const rows: (string | number)[][] = [];
  data.sales.forEach((a) => rows.push([`${a.accountCode} — ${a.accountName}`, formatMoney(a.amount, currency)]));
  rows.push(['Total Sales', formatMoney(data.totalSales, currency)]);
  rows.push(['Sales Returns', `(${formatMoney(data.salesReturns, currency)})`]);
  rows.push(['Net Sales', formatMoney(data.netSales, currency)]);
  data.cogsLines.forEach((a) => rows.push([`${a.accountCode} — ${a.accountName}`, formatMoney(a.amount, currency)]));
  rows.push(['Total Cost of Goods Sold', `(${formatMoney(data.totalCogs, currency)})`]);
  rows.push(['Gross Profit', formatMoney(data.grossProfit, currency)]);
  data.expenses.forEach((a) => rows.push([`${a.accountCode} — ${a.accountName}`, formatMoney(a.amount, currency)]));
  rows.push(['Total Expenses', `(${formatMoney(data.totalExpenses, currency)})`]);
  rows.push(['Net Income', formatMoney(data.netIncome, currency)]);
  return [{ columns: ['Line Item', 'Amount'], rows, columnStyles: { 1: { halign: 'right' } } }];
}

function balanceSheetToPdfSections(data: BalanceSheetData, currency: Parameters<typeof formatMoney>[1]): PdfSection[] {
  const lineRows = (lines: AccountLine[]) => lines.map((a) => [`${a.accountCode} — ${a.accountName}`, formatMoney(a.amount, currency)]);
  return [
    {
      heading: 'Assets',
      columns: ['Account', 'Amount'],
      rows: [...lineRows(data.assets), ['Total Assets', formatMoney(data.totalAssets, currency)]],
      columnStyles: { 1: { halign: 'right' } },
    },
    {
      heading: 'Liabilities',
      columns: ['Account', 'Amount'],
      rows: [...lineRows(data.liabilities), ['Total Liabilities', formatMoney(data.totalLiabilities, currency)]],
      columnStyles: { 1: { halign: 'right' } },
    },
    {
      heading: 'Equity',
      columns: ['Account', 'Amount'],
      rows: [
        ...lineRows(data.equity),
        ['Retained Earnings (cumulative net income)', formatMoney(data.retainedEarnings, currency)],
        ['Total Equity', formatMoney(data.totalEquity, currency)],
      ],
      columnStyles: { 1: { halign: 'right' } },
    },
  ];
}

function cashFlowToPdfSections(data: CashFlowData, currency: Parameters<typeof formatMoney>[1]): PdfSection[] {
  return [
    {
      columns: ['', ''],
      rows: [
        ['Cash account', `${data.cashAccount.accountCode} — ${data.cashAccount.accountName}`],
        ['Beginning Cash Balance', formatMoney(data.beginningBalance, currency)],
      ],
    },
    {
      heading: 'Cash Movement by Activity',
      columns: ['Source', 'Net Cash Flow'],
      rows:
        data.activity.length > 0
          ? [
              ...data.activity.map((a) => [a.sourceType, formatMoney(a.netCashFlow, currency)]),
              ['Net Change', formatMoney(data.netChange, currency)],
              ['Ending Cash Balance', formatMoney(data.endingBalance, currency)],
            ]
          : [['No cash movement in this period', '']],
      columnStyles: { 1: { halign: 'right' } },
    },
  ];
}

function trialBalanceToPdfSections(data: TrialBalanceData, currency: Parameters<typeof formatMoney>[1]): PdfSection[] {
  return [
    {
      columns: ['Code', 'Account', 'Type', 'Debit', 'Credit'],
      rows: [
        ...data.rows.map((r) => [
          r.accountCode,
          r.accountName,
          r.accountType,
          r.debitBalance > 0 ? formatMoney(r.debitBalance, currency) : '',
          r.creditBalance > 0 ? formatMoney(r.creditBalance, currency) : '',
        ]),
        ['', '', 'Totals', formatMoney(data.totalDebits, currency), formatMoney(data.totalCredits, currency)],
      ],
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    },
  ];
}

function agingToPdfSections<T extends AgingBucketFields & { supplierName?: string; customerName?: string; usesSharedAccount?: boolean }>(
  data: AgingReport<T>,
  currency: Parameters<typeof formatMoney>[1],
  nameLabel: string
): PdfSection[] {
  return [
    {
      columns: [nameLabel, 'Current', '31–60 days', '61–90 days', '90+ days', 'Total Owed'],
      rows: [
        ...data.rows.map((r) => [
          (r.supplierName ?? r.customerName ?? '') + (r.usesSharedAccount ? ' (shared account)' : ''),
          formatMoney(r.current, currency),
          formatMoney(r.days31to60, currency),
          formatMoney(r.days61to90, currency),
          formatMoney(r.over90, currency),
          formatMoney(r.totalOutstanding, currency),
        ]),
        [
          'Totals',
          formatMoney(data.totals.current, currency),
          formatMoney(data.totals.days31to60, currency),
          formatMoney(data.totals.days61to90, currency),
          formatMoney(data.totals.over90, currency),
          formatMoney(data.totals.totalOutstanding, currency),
        ],
      ],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    },
  ];
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ReportsView() {
  const { selectedBranchId } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();
  const { data: company } = useCompany();

  // ---------------------------------------------------------------------------
  // Income Statement
  // ---------------------------------------------------------------------------
  const [isStart, setIsStart] = useState(monthStartISO());
  const [isEnd, setIsEnd] = useState(todayISO());

  const {
    data: incomeStatement,
    isLoading: isLoadingIS,
    isError: isErrorIS,
    error: errorIS,
  } = useQuery<IncomeStatementData>({
    queryKey: ['income-statement', selectedBranchId, isStart, isEnd],
    queryFn: () =>
      fetchJson<IncomeStatementData>(
        `/api/v1/reports/income-statement?branchId=${selectedBranchId}&startDate=${isStart}&endDate=${isEnd}`
      ),
  });

  // ---------------------------------------------------------------------------
  // Balance Sheet
  // ---------------------------------------------------------------------------
  const [asOfDate, setAsOfDate] = useState(todayISO());

  const {
    data: balanceSheet,
    isLoading: isLoadingBS,
    isError: isErrorBS,
    error: errorBS,
  } = useQuery<BalanceSheetData>({
    queryKey: ['balance-sheet', selectedBranchId, asOfDate],
    queryFn: () =>
      fetchJson<BalanceSheetData>(`/api/v1/reports/balance-sheet?branchId=${selectedBranchId}&asOfDate=${asOfDate}`),
  });

  // ---------------------------------------------------------------------------
  // Cash Flow
  // ---------------------------------------------------------------------------
  const [cfStart, setCfStart] = useState(monthStartISO());
  const [cfEnd, setCfEnd] = useState(todayISO());

  const {
    data: cashFlow,
    isLoading: isLoadingCF,
    isError: isErrorCF,
    error: errorCF,
  } = useQuery<CashFlowData>({
    queryKey: ['cash-flow', selectedBranchId, cfStart, cfEnd],
    queryFn: () =>
      fetchJson<CashFlowData>(
        `/api/v1/reports/cash-flow?branchId=${selectedBranchId}&startDate=${cfStart}&endDate=${cfEnd}`
      ),
  });

  // ---------------------------------------------------------------------------
  // Trial Balance
  // ---------------------------------------------------------------------------
  const [tbAsOfDate, setTbAsOfDate] = useState(todayISO());

  const {
    data: trialBalance,
    isLoading: isLoadingTB,
    isError: isErrorTB,
    error: errorTB,
  } = useQuery<TrialBalanceData>({
    queryKey: ['trial-balance', selectedBranchId, tbAsOfDate],
    queryFn: () =>
      fetchJson<TrialBalanceData>(
        `/api/v1/reports/trial-balance?branchId=${selectedBranchId}&asOfDate=${tbAsOfDate}`
      ),
  });

  // ---------------------------------------------------------------------------
  // AP / AR Aging — company-wide (not branch-scoped, since a supplier or
  // customer isn't tied to one branch), so neither query passes branchId.
  // ---------------------------------------------------------------------------
  const [apAsOfDate, setApAsOfDate] = useState(todayISO());
  const [arAsOfDate, setArAsOfDate] = useState(todayISO());

  const {
    data: apAging,
    isLoading: isLoadingAP,
    isError: isErrorAP,
    error: errorAP,
  } = useQuery<AgingReport<ApAgingRow>>({
    queryKey: ['ap-aging', apAsOfDate],
    queryFn: () => fetchJson<AgingReport<ApAgingRow>>(`/api/v1/reports/ap-aging?asOfDate=${apAsOfDate}`),
  });

  const {
    data: arAging,
    isLoading: isLoadingAR,
    isError: isErrorAR,
    error: errorAR,
  } = useQuery<AgingReport<ArAgingRow>>({
    queryKey: ['ar-aging', arAsOfDate],
    queryFn: () => fetchJson<AgingReport<ArAgingRow>>(`/api/v1/reports/ar-aging?asOfDate=${arAsOfDate}`),
  });

  const isBalanced = balanceSheet ? Math.abs(balanceSheet.difference) < 0.01 : true;

  return (
    <Tabs defaultValue="income" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="income" icon={TrendingUp} label="Income Statement" color="brand" />
        <TileTabsTrigger value="balance" icon={Landmark} label="Balance Sheet" color="sky" />
        <TileTabsTrigger value="cashflow" icon={Wallet} label="Cash Flow" color="teal" />
        <TileTabsTrigger value="trial-balance" icon={Scale} label="Trial Balance" color="amber" />
        <TileTabsTrigger value="ap-aging" icon={FileClock} label="AP Aging" color="rose" />
        <TileTabsTrigger value="ar-aging" icon={FileClock} label="AR Aging" color="violet" />
        <TileTabsTrigger value="business-analysis" icon={BarChart3} label="Business Analysis" color="teal" />
      </TileTabsList>

      {/* Business Analysis */}
      <TabsContent value="business-analysis">
        <BusinessAnalysisSection />
      </TabsContent>

      {/* Income Statement */}
      <TabsContent value="income">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-brand-600" /> Income Statement
            </CardTitle>
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-8 text-xs" value={isStart} onChange={(e) => setIsStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-8 text-xs" value={isEnd} onChange={(e) => setIsEnd(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs self-end"
                disabled={!incomeStatement}
                onClick={() => incomeStatement && exportReportToPdf({
                  title: 'Income Statement',
                  subtitle: `${isStart} to ${isEnd}`,
                  companyName: company?.name,
                  sections: incomeStatementToPdfSections(incomeStatement, baseCurrency),
                })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isErrorIS ? (
              <ErrorBanner message={errorIS instanceof Error ? errorIS.message : 'Unknown error'} />
            ) : isLoadingIS ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : incomeStatement ? (
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Revenue</p>
                  <Table>
                    <TableBody>
                      {incomeStatement.sales.length === 0 ? (
                        <TableRow><TableCell colSpan={2} className="text-xs text-muted-foreground py-2">No sales in this period</TableCell></TableRow>
                      ) : (
                        incomeStatement.sales.map((r) => (
                          <TableRow key={r.accountId}>
                            <TableCell className="text-sm py-1.5">{r.accountCode} — {r.accountName}</TableCell>
                            <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(r.amount, baseCurrency)}</TableCell>
                          </TableRow>
                        ))
                      )}
                      <TableRow>
                        <TableCell className="text-sm py-1.5">Sales</TableCell>
                        <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(incomeStatement.totalSales, baseCurrency)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm py-1.5 text-muted-foreground">
                          Sales Returns
                          {!incomeStatement.salesReturnsAccountConfigured && (
                            <span className="text-[10px] text-amber-700 ml-1.5">(not mapped — see Settings → GL Mappings)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm py-1.5 text-right w-32 text-muted-foreground">({formatMoney(incomeStatement.salesReturns, baseCurrency)})</TableCell>
                      </TableRow>
                      <TableRow className="border-t">
                        <TableCell className="text-sm font-semibold py-1.5">Net Sales</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right">{formatMoney(incomeStatement.netSales, baseCurrency)}</TableCell>
                      </TableRow>
                      {incomeStatement.cogsLines.length > 0 ? (
                        incomeStatement.cogsLines.map((c) => (
                          <TableRow key={c.accountId}>
                            <TableCell className="text-sm py-1.5 text-muted-foreground">{c.accountCode} — {c.accountName}</TableCell>
                            <TableCell className="text-sm py-1.5 text-right w-32 text-muted-foreground">({formatMoney(c.amount, baseCurrency)})</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell className="text-sm py-1.5 text-muted-foreground">
                            Cost of Goods Sold
                            {!incomeStatement.cogsAccountConfigured && (
                              <span className="text-[10px] text-amber-700 ml-1.5">(not mapped — see Settings → GL Mappings)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm py-1.5 text-right w-32 text-muted-foreground">({formatMoney(0, baseCurrency)})</TableCell>
                        </TableRow>
                      )}
                      <TableRow className="border-t-2">
                        <TableCell className={cn('text-sm font-bold py-1.5', incomeStatement.grossProfit >= 0 ? 'text-brand-700' : 'text-rose-700')}>
                          Gross Profit{incomeStatement.grossProfit < 0 ? '/(Loss)' : ''}
                        </TableCell>
                        <TableCell className={cn('text-sm font-bold py-1.5 text-right', incomeStatement.grossProfit >= 0 ? 'text-brand-700' : 'text-rose-700')}>
                          {incomeStatement.grossProfit < 0
                            ? `(${formatMoney(Math.abs(incomeStatement.grossProfit), baseCurrency)})`
                            : formatMoney(incomeStatement.grossProfit, baseCurrency)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Expenses</p>
                  <Table>
                    <TableBody>
                      {incomeStatement.expenses.length === 0 ? (
                        <TableRow><TableCell colSpan={2} className="text-xs text-muted-foreground py-2">No expenses in this period</TableCell></TableRow>
                      ) : (
                        incomeStatement.expenses.map((e) => (
                          <TableRow key={e.accountId}>
                            <TableCell className="text-sm py-1.5">{e.accountCode} — {e.accountName}</TableCell>
                            <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(e.amount, baseCurrency)}</TableCell>
                          </TableRow>
                        ))
                      )}
                      <TableRow className="border-t-2">
                        <TableCell className="text-sm font-semibold py-1.5">Total Expenses</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right text-rose-700">{formatMoney(incomeStatement.totalExpenses, baseCurrency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className={`flex items-center justify-between rounded-md border p-3 ${incomeStatement.netIncome >= 0 ? 'border-brand-300 bg-brand-50' : 'border-rose-300 bg-rose-50'}`}>
                  <span className="text-sm font-semibold">Net Income{incomeStatement.netIncome < 0 ? '/(Loss)' : ''}</span>
                  <span className={`text-base font-bold ${incomeStatement.netIncome >= 0 ? 'text-brand-700' : 'text-rose-700'}`}>
                    {incomeStatement.netIncome < 0
                      ? `(${formatMoney(Math.abs(incomeStatement.netIncome), baseCurrency)})`
                      : formatMoney(incomeStatement.netIncome, baseCurrency)}
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Balance Sheet */}
      <TabsContent value="balance">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4 text-brand-600" /> Balance Sheet
            </CardTitle>
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-xs">As of</Label>
                <Input type="date" className="h-8 text-xs" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs self-end"
                disabled={!balanceSheet}
                onClick={() => balanceSheet && exportReportToPdf({
                  title: 'Balance Sheet',
                  subtitle: `As of ${asOfDate}`,
                  companyName: company?.name,
                  sections: balanceSheetToPdfSections(balanceSheet, baseCurrency),
                })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isErrorBS ? (
              <ErrorBanner message={errorBS instanceof Error ? errorBS.message : 'Unknown error'} />
            ) : isLoadingBS ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : balanceSheet ? (
              <div className="p-4 space-y-4">
                {!isBalanced && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    Assets don&apos;t equal Liabilities + Equity (difference: {formatMoney(balanceSheet.difference, baseCurrency)}) —
                    check for unbalanced entries or misclassified accounts.
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Assets</p>
                  <Table>
                    <TableBody>
                      {balanceSheet.assets.map((a) => (
                        <TableRow key={a.accountId}>
                          <TableCell className="text-sm py-1.5">{a.accountCode} — {a.accountName}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(a.amount, baseCurrency)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell className="text-sm font-semibold py-1.5">Total Assets</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right">{formatMoney(balanceSheet.totalAssets, baseCurrency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Liabilities</p>
                  <Table>
                    <TableBody>
                      {balanceSheet.liabilities.map((l) => (
                        <TableRow key={l.accountId}>
                          <TableCell className="text-sm py-1.5">{l.accountCode} — {l.accountName}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(l.amount, baseCurrency)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell className="text-sm font-semibold py-1.5">Total Liabilities</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right">{formatMoney(balanceSheet.totalLiabilities, baseCurrency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Equity</p>
                  <Table>
                    <TableBody>
                      {balanceSheet.equity.map((e) => (
                        <TableRow key={e.accountId}>
                          <TableCell className="text-sm py-1.5">{e.accountCode} — {e.accountName}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(e.amount, baseCurrency)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="text-sm py-1.5 text-muted-foreground">Retained Earnings (cumulative net income)</TableCell>
                        <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(balanceSheet.retainedEarnings, baseCurrency)}</TableCell>
                      </TableRow>
                      <TableRow className="border-t-2">
                        <TableCell className="text-sm font-semibold py-1.5">Total Equity</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right">{formatMoney(balanceSheet.totalEquity, baseCurrency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className={`flex items-center justify-between rounded-md border p-3 ${isBalanced ? 'border-brand-300 bg-brand-50' : 'border-amber-300 bg-amber-50'}`}>
                  <span className="text-sm font-semibold">Total Liabilities + Equity</span>
                  <span className="flex items-center gap-2 text-base font-bold">
                    {formatMoney(balanceSheet.totalLiabilities + balanceSheet.totalEquity, baseCurrency)}
                    {isBalanced && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Cash Flow */}
      <TabsContent value="cashflow">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-brand-600" /> Cash Flow Statement
            </CardTitle>
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-8 text-xs" value={cfStart} onChange={(e) => setCfStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-8 text-xs" value={cfEnd} onChange={(e) => setCfEnd(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs self-end"
                disabled={!cashFlow}
                onClick={() => cashFlow && exportReportToPdf({
                  title: 'Cash Flow Statement',
                  subtitle: `${cfStart} to ${cfEnd}`,
                  companyName: company?.name,
                  sections: cashFlowToPdfSections(cashFlow, baseCurrency),
                })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isErrorCF ? (
              <ErrorBanner message={errorCF instanceof Error ? errorCF.message : 'Unknown error'} />
            ) : isLoadingCF ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : cashFlow ? (
              <div className="p-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Cash account: <span className="font-medium">{cashFlow.cashAccount.accountCode} — {cashFlow.cashAccount.accountName}</span>
                </p>

                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm py-1.5">Beginning Cash Balance</TableCell>
                      <TableCell className="text-sm py-1.5 text-right w-32">{formatMoney(cashFlow.beginningBalance, baseCurrency)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cash Movement by Activity</p>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead className="text-xs">Source</TableHead><TableHead className="text-xs text-right">Net Cash Flow</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {cashFlow.activity.length === 0 ? (
                        <TableRow><TableCell colSpan={2} className="text-xs text-muted-foreground py-2">No cash movement in this period</TableCell></TableRow>
                      ) : (
                        cashFlow.activity.map((a) => (
                          <TableRow key={a.sourceType}>
                            <TableCell className="text-sm py-1.5">{a.sourceType}</TableCell>
                            <TableCell className={`text-sm py-1.5 text-right w-32 ${a.netCashFlow >= 0 ? 'text-brand-700' : 'text-rose-700'}`}>
                              {formatMoney(a.netCashFlow, baseCurrency)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <Table>
                  <TableBody>
                    <TableRow className="border-t-2">
                      <TableCell className="text-sm font-semibold py-1.5">Net Change in Cash</TableCell>
                      <TableCell className={`text-sm font-semibold py-1.5 text-right ${cashFlow.netChange >= 0 ? 'text-brand-700' : 'text-rose-700'}`}>
                        {formatMoney(cashFlow.netChange, baseCurrency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 p-3">
                  <span className="text-sm font-semibold">Ending Cash Balance</span>
                  <span className="text-base font-bold text-brand-700">{formatMoney(cashFlow.endingBalance, baseCurrency)}</span>
                </div>

                <p className="text-[11px] text-muted-foreground pt-1">
                  Simplified cash flow view: grouped by transaction source rather than full IAS 7 Operating/Investing/Financing classification.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Trial Balance */}
      <TabsContent value="trial-balance">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4 text-brand-600" /> Trial Balance
            </CardTitle>
            <div className="flex items-center gap-2">
              <div>
                <Label className="text-xs">As of</Label>
                <Input type="date" className="h-8 text-xs" value={tbAsOfDate} onChange={(e) => setTbAsOfDate(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs self-end"
                disabled={!trialBalance}
                onClick={() => trialBalance && exportReportToPdf({
                  title: 'Trial Balance',
                  subtitle: `As of ${tbAsOfDate}`,
                  companyName: company?.name,
                  sections: trialBalanceToPdfSections(trialBalance, baseCurrency),
                })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isErrorTB ? (
              <ErrorBanner message={errorTB instanceof Error ? errorTB.message : 'Unknown error'} />
            ) : isLoadingTB ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : trialBalance ? (
              <div className="p-4 space-y-4">
                {!trialBalance.isBalanced && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    Debits don&apos;t equal credits (difference: {formatMoney(Math.abs(trialBalance.difference), baseCurrency)}) —
                    check for an unbalanced entry before closing this period.
                  </div>
                )}

                {trialBalance.rows.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Code</TableHead>
                        <TableHead className="text-xs">Account</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs text-right">Debit</TableHead>
                        <TableHead className="text-xs text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trialBalance.rows.map((r) => (
                        <TableRow key={r.accountId}>
                          <TableCell className="text-sm py-1.5">{r.accountCode}</TableCell>
                          <TableCell className="text-sm py-1.5">{r.accountName}</TableCell>
                          <TableCell className="text-xs py-1.5 text-muted-foreground">{r.accountType}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right w-32">{r.debitBalance > 0 ? formatMoney(r.debitBalance, baseCurrency) : ''}</TableCell>
                          <TableCell className="text-sm py-1.5 text-right w-32">{r.creditBalance > 0 ? formatMoney(r.creditBalance, baseCurrency) : ''}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell colSpan={3} className="text-sm font-semibold py-1.5">Totals</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right">{formatMoney(trialBalance.totalDebits, baseCurrency)}</TableCell>
                        <TableCell className="text-sm font-semibold py-1.5 text-right">{formatMoney(trialBalance.totalCredits, baseCurrency)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground p-4 text-center">No ledger activity as of this date.</p>
                )}

                <div className={`flex items-center justify-between rounded-md border p-3 ${trialBalance.isBalanced ? 'border-brand-300 bg-brand-50' : 'border-amber-300 bg-amber-50'}`}>
                  <span className="text-sm font-semibold">Debits = Credits?</span>
                  <span className="flex items-center gap-2 text-base font-bold">
                    {trialBalance.isBalanced ? 'Balanced' : `Off by ${formatMoney(Math.abs(trialBalance.difference), baseCurrency)}`}
                    {trialBalance.isBalanced && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground pt-1">
                  Raw ledger balances only — no retained-earnings roll-up. This is the check to run before closing an
                  accounting period (see Accounting → Periods).
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>

      {/* AP Aging */}
      <TabsContent value="ap-aging">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileClock className="h-4 w-4 text-brand-600" /> Accounts Payable Aging
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">As of</Label>
              <Input type="date" className="h-9 w-40" value={apAsOfDate} onChange={(e) => setApAsOfDate(e.target.value)} />
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                disabled={!apAging}
                onClick={() => apAging && exportReportToPdf({
                  title: 'Accounts Payable Aging',
                  subtitle: `As of ${apAsOfDate}`,
                  companyName: company?.name,
                  sections: agingToPdfSections(apAging, baseCurrency, 'Supplier'),
                })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isErrorAP ? (
              <ErrorBanner message={errorAP instanceof Error ? errorAP.message : 'Unknown error'} />
            ) : isLoadingAP ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : apAging ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Current</TableHead>
                        <TableHead>31–60 days</TableHead>
                        <TableHead>61–90 days</TableHead>
                        <TableHead>90+ days</TableHead>
                        <TableHead>Total Owed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apAging.rows.map((r) => (
                        <TableRow key={r.supplierId}>
                          <TableCell className="text-sm font-medium">
                            {r.supplierName}
                            {r.usesSharedAccount && r.totalCharged > 0 && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] text-amber-700 border-amber-300">shared AP account</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{formatMoney(r.current, baseCurrency?.symbol)}</TableCell>
                          <TableCell className="text-sm">{formatMoney(r.days31to60, baseCurrency?.symbol)}</TableCell>
                          <TableCell className={cn('text-sm', r.days61to90 > 0 && 'text-amber-700 font-medium')}>{formatMoney(r.days61to90, baseCurrency?.symbol)}</TableCell>
                          <TableCell className={cn('text-sm', r.over90 > 0 && 'text-rose-700 font-semibold')}>{formatMoney(r.over90, baseCurrency?.symbol)}</TableCell>
                          <TableCell className="text-sm font-semibold">{formatMoney(r.totalOutstanding, baseCurrency?.symbol)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm bg-muted/30">
                  <span className="font-semibold">Totals</span>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span>Current: <strong>{formatMoney(apAging.totals.current, baseCurrency?.symbol)}</strong></span>
                    <span>31–60: <strong>{formatMoney(apAging.totals.days31to60, baseCurrency?.symbol)}</strong></span>
                    <span>61–90: <strong>{formatMoney(apAging.totals.days61to90, baseCurrency?.symbol)}</strong></span>
                    <span>90+: <strong>{formatMoney(apAging.totals.over90, baseCurrency?.symbol)}</strong></span>
                    <span>Total: <strong>{formatMoney(apAging.totals.totalOutstanding, baseCurrency?.symbol)}</strong></span>
                  </div>
                </div>
                <p className="px-4 py-3 text-[11px] text-muted-foreground border-t">
                  Suppliers marked &quot;shared AP account&quot; aren&apos;t yet linked to their own payable account (Catalog → Suppliers) —
                  their gross amount owed is shown, but payments against the shared account can&apos;t be attributed to them individually yet.
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </TabsContent>

      {/* AR Aging */}
      <TabsContent value="ar-aging">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileClock className="h-4 w-4 text-brand-600" /> Accounts Receivable Aging
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">As of</Label>
              <Input type="date" className="h-9 w-40" value={arAsOfDate} onChange={(e) => setArAsOfDate(e.target.value)} />
              <Button
                size="sm"
                variant="outline"
                className="h-9 text-xs"
                disabled={!arAging}
                onClick={() => arAging && exportReportToPdf({
                  title: 'Accounts Receivable Aging',
                  subtitle: `As of ${arAsOfDate}`,
                  companyName: company?.name,
                  sections: agingToPdfSections(arAging, baseCurrency, 'Customer'),
                })}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isErrorAR ? (
              <ErrorBanner message={errorAR instanceof Error ? errorAR.message : 'Unknown error'} />
            ) : isLoadingAR ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : arAging && arAging.rows.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer / Insurer</TableHead>
                        <TableHead>Claims</TableHead>
                        <TableHead>Current</TableHead>
                        <TableHead>31–60 days</TableHead>
                        <TableHead>61–90 days</TableHead>
                        <TableHead>90+ days</TableHead>
                        <TableHead>Total Owed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {arAging.rows.map((r) => (
                        <TableRow key={r.customerName}>
                          <TableCell className="text-sm font-medium">{r.customerName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.claimCount}</TableCell>
                          <TableCell className="text-sm">{formatMoney(r.current, baseCurrency?.symbol)}</TableCell>
                          <TableCell className="text-sm">{formatMoney(r.days31to60, baseCurrency?.symbol)}</TableCell>
                          <TableCell className={cn('text-sm', r.days61to90 > 0 && 'text-amber-700 font-medium')}>{formatMoney(r.days61to90, baseCurrency?.symbol)}</TableCell>
                          <TableCell className={cn('text-sm', r.over90 > 0 && 'text-rose-700 font-semibold')}>{formatMoney(r.over90, baseCurrency?.symbol)}</TableCell>
                          <TableCell className="text-sm font-semibold">{formatMoney(r.totalOutstanding, baseCurrency?.symbol)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm bg-muted/30">
                  <span className="font-semibold">Totals</span>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span>Current: <strong>{formatMoney(arAging.totals.current, baseCurrency?.symbol)}</strong></span>
                    <span>31–60: <strong>{formatMoney(arAging.totals.days31to60, baseCurrency?.symbol)}</strong></span>
                    <span>61–90: <strong>{formatMoney(arAging.totals.days61to90, baseCurrency?.symbol)}</strong></span>
                    <span>90+: <strong>{formatMoney(arAging.totals.over90, baseCurrency?.symbol)}</strong></span>
                    <span>Total: <strong>{formatMoney(arAging.totals.totalOutstanding, baseCurrency?.symbol)}</strong></span>
                  </div>
                </div>
                <p className="px-4 py-3 text-[11px] text-muted-foreground border-t">
                  Reflects insurance claims raised via Point of Sale, grouped by customer. There&apos;s no dedicated &quot;record a
                  collection&quot; step yet, so amounts shown are gross since the sale — not netted against any later collection.
                </p>
              </>
            ) : (
              <div className="p-8 text-center">
                <FileClock className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No insurance sales recorded yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
