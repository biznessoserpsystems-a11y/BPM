'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Warehouse as WarehouseIcon,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  ArrowLeftRight,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { usePharmacyStore } from '@/lib/store';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

// =============================================================================
// TYPES
// =============================================================================

interface ShelfProduct {
  productId: number;
  skuCode: string;
  brandName: string;
  genericName: string;
  category: string;
  reorderLevel: number;
  totalQuantity: number;
  totalValue: number;
  nearestExpiryDate: string | null;
  batchCount: number;
  isLowStock: boolean;
  isExpiringSoon: boolean;
  isEmpty: boolean;
}

interface Batch {
  id: string;
  batchNumber: string;
  quantityInStock: number;
  purchasePrice: number;
  sellingPrice: number;
  expiryDate: string;
  supplier?: { name: string };
}

interface HistoryEntry {
  type: 'SALE' | 'RECEIPT' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN';
  date: string;
  quantityChange: number;
  reference: string;
  detail: string;
}

interface ProductDetail {
  product: { id: number; brandName: string; genericName: string; skuCode: string; category: string; reorderLevel: number };
  batches: Batch[];
  history: HistoryEntry[];
}

const HISTORY_STYLES: Record<HistoryEntry['type'], { label: string; icon: typeof ArrowUpCircle; color: string }> = {
  SALE: { label: 'Sale', icon: ArrowDownCircle, color: 'text-rose-600' },
  RECEIPT: { label: 'Goods Received', icon: ArrowUpCircle, color: 'text-teal-600' },
  ADJUSTMENT: { label: 'Adjustment', icon: RefreshCw, color: 'text-amber-600' },
  TRANSFER_OUT: { label: 'Transfer Out', icon: ArrowLeftRight, color: 'text-rose-600' },
  TRANSFER_IN: { label: 'Transfer In', icon: ArrowLeftRight, color: 'text-teal-600' },
};

function shelfTone(shelf: ShelfProduct): { ring: string; iconBg: string; iconText: string } {
  if (shelf.isEmpty) return { ring: 'border-slate-200', iconBg: 'bg-slate-100', iconText: 'text-slate-500' };
  if (shelf.isLowStock) return { ring: 'border-rose-300', iconBg: 'bg-rose-100', iconText: 'text-rose-600' };
  if (shelf.isExpiringSoon) return { ring: 'border-amber-300', iconBg: 'bg-amber-100', iconText: 'text-amber-600' };
  return { ring: 'border-brand-200', iconBg: 'bg-brand-100', iconText: 'text-brand-700' };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function WarehouseView() {
  const { selectedBranchId } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);

  const { data: shelves = [], isLoading, isError, error } = useQuery<ShelfProduct[]>({
    queryKey: ['warehouse', selectedBranchId],
    queryFn: () => fetchJson<ShelfProduct[]>(`/api/v1/warehouse?branchId=${selectedBranchId}`),
  });

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErrorObj } = useQuery<ProductDetail>({
    queryKey: ['warehouse-detail', selectedBranchId, selectedProductId],
    queryFn: () => fetchJson<ProductDetail>(`/api/v1/warehouse/${selectedProductId}?branchId=${selectedBranchId}`),
    enabled: selectedProductId != null,
  });

  const categories = Array.from(new Set(shelves.map((s) => s.category))).sort();

  const filtered = shelves.filter((s) => {
    const matchesSearch =
      !search ||
      s.brandName.toLowerCase().includes(search.toLowerCase()) ||
      s.genericName.toLowerCase().includes(search.toLowerCase()) ||
      s.skuCode.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'ALL' || s.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <SearchInput
            className="flex-1 min-w-48"
            placeholder="Search shelves by product, generic name, or SKU..."
            value={search}
            onChange={setSearch}
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isError ? (
        <Card><CardContent className="p-0"><ErrorBanner message={errorMessage(error)} /></CardContent></Card>
      ) : isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((shelf) => {
            const tone = shelfTone(shelf);
            return (
              <button
                key={shelf.productId}
                type="button"
                onClick={() => setSelectedProductId(shelf.productId)}
                className={`text-left rounded-xl border-2 bg-card p-3 shadow-sm hover:shadow-md hover:border-amber-400 transition-all ${tone.ring}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone.iconBg} ${tone.iconText}`}>
                    <WarehouseIcon className="h-4.5 w-4.5" />
                  </div>
                  {shelf.isLowStock && <AlertTriangle className="h-4 w-4 text-rose-500" />}
                  {!shelf.isLowStock && shelf.isExpiringSoon && <Clock className="h-4 w-4 text-amber-500" />}
                </div>
                <p className="text-sm font-medium leading-tight line-clamp-2 min-h-[2.5rem]">{shelf.brandName}</p>
                <p className="text-[10px] font-mono px-1 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block mt-1 mb-2">
                  {shelf.skuCode}
                </p>
                <div className="space-y-0.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Qty</span>
                    <span className={`font-semibold ${shelf.isLowStock ? 'text-rose-600' : ''}`}>{shelf.totalQuantity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reorder at</span>
                    <span>{shelf.reorderLevel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-medium">{formatMoney(shelf.totalValue, baseCurrency)}</span>
                  </div>
                  {shelf.nearestExpiryDate && (
                    <div className={`flex justify-between ${shelf.isExpiringSoon ? 'text-amber-700 font-medium' : ''}`}>
                      <span className="text-muted-foreground">Expires</span>
                      <span>{new Date(shelf.nearestExpiryDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <WarehouseIcon className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No products match your search.</p>
          </CardContent>
        </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={selectedProductId != null} onOpenChange={(open) => !open && setSelectedProductId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailError ? (
            <ErrorBanner message={errorMessage(detailErrorObj)} />
          ) : detailLoading ? (
            <div className="space-y-3 py-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.product.brandName}</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {detail.product.genericName} ·{' '}
                  <span className="font-mono px-1 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{detail.product.skuCode}</span>
                  {' '}· {detail.product.category}
                </p>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Batches on Shelf</p>
                  {detail.batches.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Batch</TableHead><TableHead>Qty</TableHead><TableHead>Cost</TableHead><TableHead>Price</TableHead><TableHead>Expiry</TableHead><TableHead>Supplier</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.batches.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{b.batchNumber}</TableCell>
                            <TableCell className="text-sm">{b.quantityInStock}</TableCell>
                            <TableCell className="text-sm">{formatMoney(b.purchasePrice, baseCurrency)}</TableCell>
                            <TableCell className="text-sm">{formatMoney(b.sellingPrice, baseCurrency)}</TableCell>
                            <TableCell className="text-xs">{new Date(b.expiryDate).toLocaleDateString()}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{b.supplier?.name ?? '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-xs text-muted-foreground">No batches at this branch.</p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transaction History</p>
                  {detail.history.length > 0 ? (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto">
                      {detail.history.map((h, i) => {
                        const style = HISTORY_STYLES[h.type];
                        const Icon = style.icon;
                        return (
                          <div key={i} className="flex items-center justify-between text-xs border rounded-md px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${style.color}`} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline" className="text-[10px]">{style.label}</Badge>
                                  <span className="font-mono text-[10px] text-muted-foreground">{h.reference}</span>
                                </div>
                                <p className="text-muted-foreground truncate">{h.detail}</p>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 pl-2">
                              <p className={`font-semibold ${h.quantityChange >= 0 ? 'text-teal-700' : 'text-rose-700'}`}>
                                {h.quantityChange >= 0 ? '+' : ''}{h.quantityChange}
                              </p>
                              <p className="text-muted-foreground">{new Date(h.date).toLocaleDateString()}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No recorded transactions for this product at this branch yet.</p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
