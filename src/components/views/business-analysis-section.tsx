'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Boxes, Users, Truck, ShoppingCart, Wallet, Landmark } from 'lucide-react';
import { usePharmacyStore } from '@/lib/store';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';

// Matches this app's established "apothecary ledger" palette (brand
// green + amber accent) closely enough for chart use without needing to
// resolve the exact oklch theme variables at render time.
const COLORS = {
  brand: '#15803d',
  amber: '#d97706',
  rose: '#e11d48',
  sky: '#0284c7',
  violet: '#7c3aed',
  teal: '#0d9488',
};
const PAYMENT_METHOD_COLORS: Record<string, string> = {
  CASH: COLORS.brand,
  CARD: COLORS.sky,
  MOBILE_MONEY: COLORS.amber,
  INSURANCE: COLORS.violet,
};

interface IncomeStatementSummary {
  startDate: string;
  totalSales: number;
  totalExpenses: number;
  netIncome: number;
}
interface BusinessAnalysisData {
  inventoryHealth: { expired: number; expiringSoon: number; healthy: number };
  salesTrend: { label: string; total: number }[];
  paymentMethodBreakdown: { method: string; total: number }[];
}
interface AgingRow {
  supplierName?: string;
  customerName?: string;
  totalOutstanding: number;
}
interface AgingReport {
  rows: AgingRow[];
}
interface CashFlowData {
  activity: { sourceType: string; netCashFlow: number }[];
}

function monthStartISO(monthsAgo: number) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - monthsAgo, 1).toISOString().slice(0, 10);
}
function monthEndISO(monthsAgo: number) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - monthsAgo + 1, 0).toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ChartCard({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4 text-brand-600" /> {title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">{children}</div>
      </CardContent>
    </Card>
  );
}

export function BusinessAnalysisSection() {
  const { selectedBranchId } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();

  const { data: analysis, isLoading: analysisLoading, isError: analysisError, error: analysisErrorObj } = useQuery<BusinessAnalysisData>({
    queryKey: ['business-analysis'],
    queryFn: () => fetchJson<BusinessAnalysisData>('/api/v1/reports/business-analysis'),
  });

  // Six months of Income Statement data, fetched in parallel — reuses
  // the same proven, tested endpoint every other financial report on
  // this page uses, rather than re-deriving GL aggregation logic here.
  const { data: financialTrend, isLoading: financialLoading, isError: financialError, error: financialErrorObj } = useQuery<IncomeStatementSummary[]>({
    queryKey: ['business-analysis-financial-trend', selectedBranchId],
    queryFn: async () => {
      const months = await Promise.all(
        Array.from({ length: 6 }, (_, i) => 5 - i).map((monthsAgo) =>
          fetchJson<IncomeStatementSummary>(
            `/api/v1/reports/income-statement?branchId=${selectedBranchId}&startDate=${monthStartISO(monthsAgo)}&endDate=${monthEndISO(monthsAgo)}`
          )
        )
      );
      return months;
    },
  });

  const { data: arAging, isLoading: arLoading, isError: arError, error: arErrorObj } = useQuery<AgingReport>({
    queryKey: ['business-analysis-ar-aging'],
    queryFn: () => fetchJson<AgingReport>(`/api/v1/reports/ar-aging?asOfDate=${todayISO()}`),
  });

  const { data: apAging, isLoading: apLoading, isError: apError, error: apErrorObj } = useQuery<AgingReport>({
    queryKey: ['business-analysis-ap-aging'],
    queryFn: () => fetchJson<AgingReport>(`/api/v1/reports/ap-aging?asOfDate=${todayISO()}`),
  });

  const { data: cashFlow, isLoading: cashLoading, isError: cashError, error: cashErrorObj } = useQuery<CashFlowData>({
    queryKey: ['business-analysis-cash-flow', selectedBranchId],
    queryFn: () =>
      fetchJson<CashFlowData>(
        `/api/v1/reports/cash-flow?branchId=${selectedBranchId}&startDate=${monthStartISO(5)}&endDate=${todayISO()}`
      ),
  });

  const inventoryPieData = analysis
    ? [
        { name: 'Healthy', value: analysis.inventoryHealth.healthy, color: COLORS.brand },
        { name: 'Expiring Soon', value: analysis.inventoryHealth.expiringSoon, color: COLORS.amber },
        { name: 'Expired', value: analysis.inventoryHealth.expired, color: COLORS.rose },
      ].filter((d) => d.value > 0)
    : [];

  const topCustomers = arAging?.rows
    ? [...arAging.rows].sort((a, b) => b.totalOutstanding - a.totalOutstanding).slice(0, 8)
    : [];
  const topSuppliers = apAging?.rows
    ? [...apAging.rows].sort((a, b) => b.totalOutstanding - a.totalOutstanding).slice(0, 8)
    : [];

  const currencyFormatter = (v: number) => formatMoney(v, baseCurrency);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Seven views across your financial records, inventory, customers, suppliers, sales, cash, and payment channels —
        the trend charts cover the last 6 months; aging and inventory health are as of today.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 1. Financial */}
        <ChartCard icon={TrendingUp} title="Financial Trend">
          {financialError ? (
            <ErrorBanner message={errorMessage(financialErrorObj)} />
          ) : financialLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="startDate" tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short' })} fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => formatMoney(v, baseCurrency)} width={70} />
                <Tooltip formatter={currencyFormatter} labelFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="totalSales" name="Revenue" fill={COLORS.brand} radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalExpenses" name="Expenses" fill={COLORS.rose} radius={[4, 4, 0, 0]} />
                <Bar dataKey="netIncome" name="Net Income" fill={COLORS.sky} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* 2. Inventory */}
        <ChartCard icon={Boxes} title="Inventory Health (by value)">
          {analysisError ? (
            <ErrorBanner message={errorMessage(analysisErrorObj)} />
          ) : analysisLoading ? (
            <Skeleton className="h-full w-full" />
          ) : inventoryPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={inventoryPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(d) => d.name}>
                  {inventoryPieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={currencyFormatter} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No inventory in stock yet.</div>
          )}
        </ChartCard>

        {/* 3. Customers */}
        <ChartCard icon={Users} title="Top Customers by Amount Owed">
          {arError ? (
            <ErrorBanner message={errorMessage(arErrorObj)} />
          ) : arLoading ? (
            <Skeleton className="h-full w-full" />
          ) : topCustomers.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCustomers} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
                <YAxis type="category" dataKey="customerName" fontSize={11} width={90} tick={{ fontSize: 11 }} />
                <Tooltip formatter={currencyFormatter} />
                <Bar dataKey="totalOutstanding" name="Outstanding" fill={COLORS.violet} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No outstanding customer balances.</div>
          )}
        </ChartCard>

        {/* 4. Suppliers */}
        <ChartCard icon={Truck} title="Top Suppliers by Amount Owed">
          {apError ? (
            <ErrorBanner message={errorMessage(apErrorObj)} />
          ) : apLoading ? (
            <Skeleton className="h-full w-full" />
          ) : topSuppliers.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSuppliers} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} tickFormatter={(v) => formatMoney(v, baseCurrency)} />
                <YAxis type="category" dataKey="supplierName" fontSize={11} width={90} tick={{ fontSize: 11 }} />
                <Tooltip formatter={currencyFormatter} />
                <Bar dataKey="totalOutstanding" name="Owed" fill={COLORS.amber} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No outstanding supplier balances.</div>
          )}
        </ChartCard>

        {/* 5. Sales */}
        <ChartCard icon={ShoppingCart} title="Sales Trend">
          {analysisError ? (
            <ErrorBanner message={errorMessage(analysisErrorObj)} />
          ) : analysisLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analysis?.salesTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => formatMoney(v, baseCurrency)} width={70} />
                <Tooltip formatter={currencyFormatter} />
                <Line type="monotone" dataKey="total" name="Sales" stroke={COLORS.brand} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* 6. Cash */}
        <ChartCard icon={Wallet} title="Cash Flow by Source">
          {cashError ? (
            <ErrorBanner message={errorMessage(cashErrorObj)} />
          ) : cashLoading ? (
            <Skeleton className="h-full w-full" />
          ) : cashFlow && cashFlow.activity.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashFlow.activity}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="sourceType" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => formatMoney(v, baseCurrency)} width={70} />
                <Tooltip formatter={currencyFormatter} />
                <Bar dataKey="netCashFlow" name="Net Cash Flow" radius={[4, 4, 0, 0]}>
                  {cashFlow.activity.map((entry) => (
                    <Cell key={entry.sourceType} fill={entry.netCashFlow >= 0 ? COLORS.brand : COLORS.rose} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No cash movement in the last 6 months.</div>
          )}
        </ChartCard>

        {/* 7. Bank / payment channels */}
        <ChartCard icon={Landmark} title="Payment Channels (Bank vs Cash)">
          {analysisError ? (
            <ErrorBanner message={errorMessage(analysisErrorObj)} />
          ) : analysisLoading ? (
            <Skeleton className="h-full w-full" />
          ) : analysis && analysis.paymentMethodBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analysis.paymentMethodBreakdown} dataKey="total" nameKey="method" cx="50%" cy="50%" outerRadius={80} label={(d) => d.method}>
                  {analysis.paymentMethodBreakdown.map((entry) => (
                    <Cell key={entry.method} fill={PAYMENT_METHOD_COLORS[entry.method] ?? COLORS.teal} />
                  ))}
                </Pie>
                <Tooltip formatter={currencyFormatter} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No sales in the last 6 months.</div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
