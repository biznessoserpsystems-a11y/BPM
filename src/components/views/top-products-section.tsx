'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Download, FileSpreadsheet } from 'lucide-react';
import { usePharmacyStore } from '@/lib/store';
import { fetchJson } from '@/lib/fetch-json';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { useBranches } from '@/hooks/use-branches';
import { useCompany } from '@/hooks/use-company';
import { exportReportToPdf } from '@/lib/pdf-export';
import { shiftDay, toLocalISODate, weekRangeFor } from '@/lib/week-range';
import { topProductsFileName, topProductsToCsv, topProductsToPdfSections, type TopProductsReport } from '@/lib/top-products-export';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { cn } from '@/lib/utils';

const ALL_BRANCHES = '__all__';
type Preset = 'today' | 'week' | 'month' | '30d' | 'custom';

function rangeFor(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const today = new Date();
  const to = toLocalISODate(today);
  if (preset === 'today') return { from: to, to };
  if (preset === 'week') return { from: weekRangeFor(null).weekStart, to };
  if (preset === 'month') return { from: toLocalISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  return { from: shiftDay(to, -29), to };
}

const MEDAL = ['bg-amber-100 text-amber-800 border-amber-300', 'bg-slate-100 text-slate-700 border-slate-300', 'bg-orange-100 text-orange-800 border-orange-300'];

/**
 * Reports → Top Products: the products that sold the most in a period, ranked
 * by quantity or by revenue, with returns taken off. PDF and CSV export.
 */
export function TopProductsSection() {
  const { user } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();
  const { data: company } = useCompany();
  const { branches } = useBranches();
  const canChooseBranch = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';

  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => rangeFor('month'));
  const [rankBy, setRankBy] = useState<'quantity' | 'revenue'>('quantity');
  const [limit, setLimit] = useState('20');
  const [branch, setBranch] = useState(ALL_BRANCHES);

  const range = preset === 'custom' ? custom : rangeFor(preset);
  const branchParam = canChooseBranch && branch !== ALL_BRANCHES ? `&branchId=${encodeURIComponent(branch)}` : '';
  const valid = !!range.from && !!range.to && range.from <= range.to;

  const { data: report, isLoading, isError, error } = useQuery<TopProductsReport>({
    queryKey: ['top-products', range.from, range.to, rankBy, limit, canChooseBranch ? branch : 'own'],
    queryFn: () => fetchJson<TopProductsReport>(`/api/v1/reports/top-products?from=${range.from}&to=${range.to}&rankBy=${rankBy}&limit=${limit}${branchParam}`),
    enabled: valid,
  });

  const money = (n: number) => formatMoney(n, baseCurrency);
  const branchName = branch === ALL_BRANCHES ? 'All branches' : branches.find((b) => b.id === branch)?.label ?? branch;

  const downloadCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([topProductsToCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = topProductsFileName(report, 'csv');
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadPdf = () => {
    if (!report) return;
    exportReportToPdf({
      title: 'Top Selling Products',
      subtitle: `${range.from} to ${range.to}${canChooseBranch ? ` · ${branchName}` : ''}`,
      companyName: company?.name,
      sections: topProductsToPdfSections(report, money),
    });
  };

  const top = report?.rows[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="h-4 w-4 text-amber-600" /> Top Selling Products
          </CardTitle>
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <Label className="text-xs">Period</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This week</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === 'custom' && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" className="h-8 text-xs" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" className="h-8 text-xs" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Rank by</Label>
              <Select value={rankBy} onValueChange={(v) => setRankBy(v as 'quantity' | 'revenue')}>
                <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="quantity">Quantity sold</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Show</Label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['10', '20', '50', '100'].map((n) => <SelectItem key={n} value={n}>Top {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {canChooseBranch && (
              <div>
                <Label className="text-xs">Branch</Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!report} onClick={downloadCsv}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!report} onClick={downloadPdf}>
              <Download className="h-3.5 w-3.5 mr-1" /> PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm font-medium">{range.from} – {range.to}</p>
          {!valid && <p className="text-xs text-rose-600 mt-1">Choose a start date that is on or before the end date.</p>}
        </CardContent>
      </Card>

      {isError ? (
        <ErrorBanner message={errorMessage(error)} />
      ) : !valid ? null : isLoading || !report ? (
        <Card>
          <CardContent className="p-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Best seller" value={top ? top.productName : '—'} hint={top ? (rankBy === 'quantity' ? `${top.quantitySold} sold` : money(top.revenue)) : undefined} />
            <Tile label="Products sold" value={String(report.totalProducts)} />
            <Tile label="Units sold" value={String(report.totalQuantity)} />
            <Tile label="Product sales" value={money(report.totalRevenue)} hint="before invoice discount and tax" />
          </div>

          <Card>
            <CardContent className="p-0">
              {report.rows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No sales were recorded in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right w-24">Qty sold</TableHead>
                      <TableHead className="text-right w-32">Revenue</TableHead>
                      <TableHead className="text-right w-24">Invoices</TableHead>
                      <TableHead className="w-44">Share of {rankBy === 'quantity' ? 'units' : 'revenue'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((r) => (
                      <TableRow key={r.productId}>
                        <TableCell>
                          <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold', MEDAL[r.rank - 1] ?? 'text-muted-foreground border-transparent')}>
                            {r.rank}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{r.productName}</div>
                          <div className="text-[11px] text-muted-foreground">{r.genericName}{r.sku ? ` · ${r.sku}` : ''}</div>
                        </TableCell>
                        <TableCell className="text-sm text-right">{r.quantitySold}</TableCell>
                        <TableCell className="text-sm text-right">{money(r.revenue)}</TableCell>
                        <TableCell className="text-sm text-right">{r.invoiceCount}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
                              <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, r.sharePercent)}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">{r.sharePercent}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground">Returns made against a sale are taken off the product they came back against.</p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold mt-0.5 truncate">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}
