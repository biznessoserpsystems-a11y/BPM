'use client';

import { useQuery } from '@tanstack/react-query';
import { usePharmacyStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DollarSign, AlertTriangle, Clock, ArrowLeftRight, FileText, TrendingUp, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

interface RecentSale {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  paymentMethod: string;
  customerName: string | null;
  saleDate: string;
}

interface DashboardData {
  salesToday: number;
  salesTodayAmount: number;
  lowStockCount: number;
  expiringSoonCount: number;
  pendingTransfers: number;
  activePrescriptions: number;
  recentSales: RecentSale[];
}

export function DashboardView() {
  const { selectedBranchId, setView } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', selectedBranchId],
    queryFn: () => fetchJson<DashboardData>(`/api/v1/dashboard?branchId=${selectedBranchId}`),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardContent className="p-0">
          <ErrorBanner message={errorMessage(error)} />
        </CardContent>
      </Card>
    );
  }

  const kpis = data || {
    salesToday: 0,
    salesTodayAmount: 0,
    lowStockCount: 0,
    expiringSoonCount: 0,
    pendingTransfers: 0,
    activePrescriptions: 0,
    recentSales: [],
  };

  const kpiCards = [
    {
      title: "Today's Sales",
      value: formatMoney(kpis.salesTodayAmount, baseCurrency),
      subtitle: `${kpis.salesToday} transaction${kpis.salesToday !== 1 ? 's' : ''}`,
      icon: DollarSign,
      color: 'text-brand-600',
      bg: 'bg-brand-50 border-brand-200',
      iconBg: 'bg-brand-100',
      onClick: () => setView('pos'),
    },
    {
      title: 'Low Stock Items',
      value: String(kpis.lowStockCount),
      subtitle: 'At or below reorder level',
      icon: AlertTriangle,
      color: 'text-amber-600',
      bg: 'bg-amber-50 border-amber-200',
      iconBg: 'bg-amber-100',
      onClick: () => setView('inventory', 'low-stock'),
    },
    {
      title: 'Expiring Soon',
      value: String(kpis.expiringSoonCount),
      subtitle: 'Within 30 days',
      icon: Clock,
      color: 'text-rose-600',
      bg: 'bg-rose-50 border-rose-200',
      iconBg: 'bg-rose-100',
      onClick: () => setView('inventory', 'expiring'),
    },
    {
      title: 'Pending Transfers',
      value: String(kpis.pendingTransfers),
      subtitle: 'Awaiting approval',
      icon: ArrowLeftRight,
      color: 'text-amber-600',
      bg: 'bg-amber-50 border-amber-200',
      iconBg: 'bg-amber-100',
      onClick: () => setView('transfers'),
    },
    {
      title: 'Active Prescriptions',
      value: String(kpis.activePrescriptions),
      subtitle: 'Refills available',
      icon: FileText,
      color: 'text-brand-600',
      bg: 'bg-brand-50 border-brand-200',
      iconBg: 'bg-brand-100',
      onClick: () => setView('prescriptions'),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title} className={cn('border', kpi.bg)}>
            <CardContent className="p-0">
              <button
                type="button"
                onClick={kpi.onClick}
                className="w-full text-left p-4 md:p-6 rounded-xl transition-transform hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{kpi.title}</p>
                    <p className={cn('font-display text-xl md:text-2xl font-medium', kpi.color)}>{kpi.value}</p>
                    <p className="text-[10px] text-muted-foreground">{kpi.subtitle}</p>
                  </div>
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', kpi.iconBg)}>
                    <kpi.icon className={cn('h-5 w-5', kpi.color)} />
                  </div>
                </div>
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-brand-600" />
              <CardTitle className="text-base">Recent Sales</CardTitle>
            </div>
            <button
              onClick={() => setView('pos')}
              className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1 font-medium"
            >
              <ShoppingCart className="h-3 w-3" />
              New Sale
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {kpis.recentSales && kpis.recentSales.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpis.recentSales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{sale.invoiceNumber}</TableCell>
                      <TableCell>{sale.customerName || 'Walk-in'}</TableCell>
                      <TableCell className="font-semibold">{formatMoney(sale.totalAmount, baseCurrency)}</TableCell>
                      <TableCell>
                        <span className={cn(
                          'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
                          sale.paymentMethod === 'CASH' ? 'bg-brand-50 text-brand-700' :
                          sale.paymentMethod === 'CARD' ? 'bg-blue-50 text-blue-700' :
                          sale.paymentMethod === 'MOBILE_MONEY' ? 'bg-purple-50 text-purple-700' :
                          'bg-gray-50 text-gray-700'
                        )}>
                          {sale.paymentMethod.replace('_', ' ')}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(sale.saleDate), 'MMM d, h:mm a')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8">
              <ShoppingCart className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No sales recorded today.</p>
              <button
                onClick={() => setView('pos')}
                className="mt-2 text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                Start your first sale →
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
