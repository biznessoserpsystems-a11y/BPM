'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileSpreadsheet } from 'lucide-react';
import { usePharmacyStore } from '@/lib/store';
import { fetchJson } from '@/lib/fetch-json';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { useBranches } from '@/hooks/use-branches';
import { useCompany } from '@/hooks/use-company';
import { exportReportToPdf } from '@/lib/pdf-export';
import { shiftWeek, toLocalISODate, weekRangeFor } from '@/lib/week-range';
import {
  weeklySalesFileName,
  weeklySalesToCsv,
  weeklySalesToPdfSections,
  type WeeklySalesReport,
} from '@/lib/weekly-sales-export';
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

const prettyDay = (yyyyMmDd: string) => format(new Date(`${yyyyMmDd}T00:00:00`), 'EEE d MMM');

/**
 * Reports → Weekly Sales: every invoice in one Monday–Sunday week with the
 * products sold on it and the amounts, plus the week's totals, a day-by-day
 * breakdown and any returns. Exports to PDF and to CSV for spreadsheets.
 */
export function WeeklySalesSection() {
  const { user } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();
  const { data: company } = useCompany();
  const { branches } = useBranches();
  const canChooseBranch = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';

  // `date` is any day inside the week being shown (the server aligns it to Monday).
  const [date, setDate] = useState(() => toLocalISODate(new Date()));
  const [branch, setBranch] = useState(ALL_BRANCHES);

  const week = weekRangeFor(date);
  const currentWeekStart = weekRangeFor(null).weekStart;
  const isCurrentOrFuture = week.weekStart >= currentWeekStart;

  const branchParam = canChooseBranch && branch !== ALL_BRANCHES ? `&branchId=${encodeURIComponent(branch)}` : '';
  const { data: report, isLoading, isError, error } = useQuery<WeeklySalesReport>({
    queryKey: ['weekly-sales', week.weekStart, canChooseBranch ? branch : 'own'],
    queryFn: () => fetchJson<WeeklySalesReport>(`/api/v1/reports/weekly-sales?date=${week.weekStart}${branchParam}`),
  });

  const money = (n: number) => formatMoney(n, baseCurrency);
  const branchName = branch === ALL_BRANCHES ? 'All branches' : branches.find((b) => b.id === branch)?.label ?? branch;
  const weekLabel = `${prettyDay(week.weekStart)} – ${prettyDay(week.weekEnd)} ${week.weekEnd.slice(0, 4)}`;

  const downloadCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([weeklySalesToCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = weeklySalesFileName(report, 'csv');
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    if (!report) return;
    exportReportToPdf({
      title: 'Weekly Sales Report',
      subtitle: `${weekLabel}${canChooseBranch ? ` · ${branchName}` : ''}`,
      companyName: company?.name,
      sections: weeklySalesToPdfSections(report, money),
    });
  };

  const s = report?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-orange-600" /> Weekly Sales
          </CardTitle>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex items-end gap-1">
              <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Previous week" onClick={() => setDate(shiftWeek(week.weekStart, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div>
                <Label className="text-xs">Week containing</Label>
                <Input type="date" className="h-8 text-xs" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                aria-label="Next week"
                disabled={isCurrentOrFuture}
                onClick={() => setDate(shiftWeek(week.weekStart, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={week.weekStart === currentWeekStart} onClick={() => setDate(toLocalISODate(new Date()))}>
                This week
              </Button>
            </div>

            {canChooseBranch && (
              <div>
                <Label className="text-xs">Branch</Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger className="h-8 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label}
                      </SelectItem>
                    ))}
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
          <p className="text-sm font-medium">{weekLabel}</p>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorBanner message={errorMessage(error)} />
      ) : isLoading || !report || !s ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryTile label="Invoices" value={String(s.invoiceCount)} />
            <SummaryTile label="Items sold" value={String(s.itemsSold)} />
            <SummaryTile label="Total sales" value={money(s.totalSales)} hint={s.discounts > 0 || s.tax > 0 ? `after ${money(s.discounts)} discounts, incl. ${money(s.tax)} tax` : undefined} />
            {s.returnsTotal > 0 ? (
              <SummaryTile label="Net of returns" value={money(s.netSales)} hint={`${money(s.returnsTotal)} returned`} />
            ) : (
              <SummaryTile label="Returns" value={money(0)} />
            )}
          </div>

          <Card>
            <CardContent className="p-3">
              <div className="grid grid-cols-7 gap-2">
                {report.days.map((d) => (
                  <div key={d.date} className={cn('rounded-md border p-2 text-center', d.invoiceCount === 0 && 'bg-muted/40 text-muted-foreground')}>
                    <div className="text-[11px] font-medium uppercase tracking-wide">{d.label}</div>
                    <div className="text-[11px] text-muted-foreground">{d.date.slice(8)}</div>
                    <div className="text-xs font-semibold mt-1 truncate">{money(d.total)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {d.invoiceCount} {d.invoiceCount === 1 ? 'invoice' : 'invoices'}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {report.invoices.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No sales were recorded this week.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">Invoice ref</TableHead>
                      <TableHead className="w-40">Date &amp; time</TableHead>
                      <TableHead>Product sold</TableHead>
                      <TableHead className="text-right w-20">Qty</TableHead>
                      <TableHead className="text-right w-32">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.invoices.map((inv) => (
                      <Fragment key={inv.id}>
                        {inv.items.map((item, i) => (
                          <TableRow key={`${inv.id}-${i}`} className={cn(i === 0 && 'border-t-2')}>
                            <TableCell className="text-sm font-mono align-top">
                              {i === 0 && (
                                <>
                                  <div className="font-semibold">{inv.invoiceNumber}</div>
                                  <div className="text-[11px] font-sans text-muted-foreground">
                                    {inv.cashier ?? '—'} · {inv.paymentMethod.replace(/_/g, ' ').toLowerCase()}
                                  </div>
                                </>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground align-top">
                              {i === 0 && format(new Date(inv.saleDate), 'EEE d MMM, HH:mm')}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div>{item.productName}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {item.genericName}
                                {item.returnedQuantity > 0 && <span className="text-rose-600"> · {item.returnedQuantity} returned</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-right">{item.quantity}</TableCell>
                            <TableCell className="text-sm text-right">{money(item.amount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={4} className="text-xs text-right text-muted-foreground py-1.5">
                            {inv.discountAmount > 0 && <>Discount −{money(inv.discountAmount)} · </>}
                            {inv.taxAmount > 0 && <>Tax +{money(inv.taxAmount)} · </>}
                            <span className="font-medium text-foreground">Invoice total</span>
                          </TableCell>
                          <TableCell className="text-sm text-right font-semibold py-1.5">{money(inv.totalAmount)}</TableCell>
                        </TableRow>
                      </Fragment>
                    ))}
                    <TableRow className="border-t-2 bg-muted/50">
                      <TableCell colSpan={4} className="text-sm text-right font-semibold">
                        Week total
                      </TableCell>
                      <TableCell className="text-sm text-right font-bold">{money(s.totalSales)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {report.returns.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Returns made this week</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Invoice ref</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.returns.map((r) => (
                      <TableRow key={r.returnNumber}>
                        <TableCell className="text-sm font-mono">{r.returnNumber}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(r.returnDate), 'EEE d MMM, HH:mm')}</TableCell>
                        <TableCell className="text-sm font-mono">{r.invoiceNumber}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.reason ?? '—'}</TableCell>
                        <TableCell className="text-sm text-right text-rose-700">−{money(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold mt-0.5">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}
