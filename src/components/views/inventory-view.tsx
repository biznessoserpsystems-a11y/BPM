'use client';

import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePharmacyStore } from '@/lib/store';
import { useModuleAccess } from '@/hooks/use-module-access';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Package, AlertTriangle, Clock, Plus, PackagePlus, ScanBarcode } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

interface Batch {
  id: string;
  batchNumber: string;
  productId: number;
  branchId: string;
  quantityInStock: number;
  purchasePrice: number;
  sellingPrice: number;
  expiryDate: string;
  product?: { brandName: string; genericName: string; skuCode: string };
  supplier?: { name: string };
}

interface LowStockItem {
  productId: number;
  brandName: string;
  genericName: string;
  totalQty: number;
  reorderLevel: number;
}

interface ExpiringItem {
  batchId: string;
  batchNumber: string;
  productId: number;
  brandName: string;
  genericName: string;
  currentQty: number;
  expiryDate: string;
  daysUntilExpiry: number;
}

interface Product {
  id: number;
  brandName: string;
  genericName: string;
  skuCode: string;
}

interface Supplier {
  id: number;
  name: string;
}

export function InventoryView() {
  const { selectedBranchId, user, consumePendingTab } = usePharmacyStore();
  const { canEdit } = useModuleAccess();
  const canEditInventory = canEdit('inventory');
  const queryClient = useQueryClient();
  const baseCurrency = useBaseCurrency();
  const batchNumberRef = useRef<HTMLInputElement>(null);
  const expiryDateRef = useRef<HTMLInputElement>(null);
  // Lazy initializer so consumePendingTab() (which clears the pending tab
  // as a side effect) only runs once on mount, not on every re-render —
  // lets a Dashboard KPI card land here on a specific tab (e.g. "Low
  // Stock") instead of always the default.
  const [activeTab, setActiveTab] = useState(() => consumePendingTab() ?? 'batches');
  const [batchSearch, setBatchSearch] = useState('');
  // Computed once per mount instead of once per row in the list below —
  // cuts N calls down to 1. The react-hooks/purity rule still flags any
  // Date.now() read during render regardless of memoization, so this stays
  // a lint warning rather than a clean pass; see eslint.config.js for why
  // that rule is downgraded to warn rather than treated as blocking.
  const now = useMemo(() => Date.now(), []);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState({
    productId: '',
    supplierId: '',
    batchNumber: '',
    expiryDate: '',
    purchasePrice: '',
    sellingPrice: '',
    quantity: '',
  });

  const { data: batches = [], isLoading: batchesLoading, isError: batchesError, error: batchesErrorObj } = useQuery<Batch[]>({
    queryKey: ['inventory-batches', selectedBranchId],
    queryFn: () => fetchJson<Batch[]>(`/api/v1/inventory/batches?branchId=${selectedBranchId}`),
  });

  const filteredBatches = batches.filter((b) => {
    const q = batchSearch.toLowerCase();
    if (!q) return true;
    return (
      b.batchNumber.toLowerCase().includes(q) ||
      (b.product?.brandName.toLowerCase().includes(q) ?? false) ||
      (b.product?.genericName.toLowerCase().includes(q) ?? false) ||
      (b.product?.skuCode.toLowerCase().includes(q) ?? false) ||
      (b.supplier?.name.toLowerCase().includes(q) ?? false)
    );
  });

  const { data: lowStock = [], isLoading: lowStockLoading, isError: lowStockError, error: lowStockErrorObj } = useQuery<LowStockItem[]>({
    queryKey: ['low-stock', selectedBranchId],
    queryFn: () => fetchJson<LowStockItem[]>(`/api/v1/inventory/low-stock?branchId=${selectedBranchId}`),
  });

  const { data: expiring = [], isLoading: expiringLoading, isError: expiringError, error: expiringErrorObj } = useQuery<ExpiringItem[]>({
    queryKey: ['expiring', selectedBranchId],
    queryFn: () => fetchJson<ExpiringItem[]>(`/api/v1/inventory/expiring?branchId=${selectedBranchId}&withinDays=90`),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-list'],
    queryFn: () => fetchJson<Product[]>('/api/v1/products'),
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers-list'],
    queryFn: () => fetchJson<Supplier[]>('/api/v1/suppliers'),
  });

  const receiveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/inventory/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Goods received successfully!');
      setReceiveOpen(false);
      setReceiveForm({
        productId: '',
        supplierId: '',
        batchNumber: '',
        expiryDate: '',
        purchasePrice: '',
        sellingPrice: '',
        quantity: '',
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleReceive = () => {
    if (!receiveForm.productId || !receiveForm.batchNumber || !receiveForm.expiryDate || !receiveForm.quantity) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (!user?.id) {
      toast.error('Your session looks invalid — please log in again');
      return;
    }
    receiveMutation.mutate({
      branchId: selectedBranchId,
      productId: Number(receiveForm.productId),
      supplierId: receiveForm.supplierId ? Number(receiveForm.supplierId) : undefined,
      batchNumber: receiveForm.batchNumber,
      expiryDate: receiveForm.expiryDate,
      purchasePrice: Number(receiveForm.purchasePrice) || 0,
      sellingPrice: Number(receiveForm.sellingPrice) || 0,
      quantityReceived: Number(receiveForm.quantity),
      receivedByUserId: user.id,
    });
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <TileTabsList>
          <TileTabsTrigger value="batches" icon={Package} label="Batches" color="brand" />
          {canEditInventory && (
            <TileTabsTrigger value="receive" icon={PackagePlus} label="Receive Goods" color="teal" />
          )}
          <TileTabsTrigger value="low-stock" icon={AlertTriangle} label="Low Stock" color="rose" />
          <TileTabsTrigger value="expiring" icon={Clock} label="Expiring Soon" color="amber" />
        </TileTabsList>
        {canEditInventory && (
        <Dialog
          open={receiveOpen}
          onOpenChange={(open) => {
            setReceiveOpen(open);
            if (open) {
              // Small delay so focus lands after the dialog's own open
              // transition/mount, not before the input exists in the DOM.
              setTimeout(() => batchNumberRef.current?.focus(), 50);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
              <Plus className="h-4 w-4 mr-1" /> Receive Goods
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Receive Goods</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Product *</Label>
                <Select
                  value={receiveForm.productId}
                  onValueChange={(v) => setReceiveForm((f) => ({ ...f, productId: v }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.brandName} ({p.genericName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Supplier</Label>
                <Select
                  value={receiveForm.supplierId}
                  onValueChange={(v) => setReceiveForm((f) => ({ ...f, supplierId: v }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers?.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs flex items-center gap-1">
                    Batch Number * <ScanBarcode className="h-3 w-3 text-muted-foreground" />
                  </Label>
                  <Input
                    ref={batchNumberRef}
                    className="h-9"
                    placeholder="Scan or type batch number"
                    value={receiveForm.batchNumber}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, batchNumber: e.target.value }))}
                    onKeyDown={(e) => {
                      // A barcode/QR scanner acts as a keyboard — it types the
                      // scanned text into whichever field has focus, then sends
                      // Enter. Catching that here moves focus straight to the
                      // next field instead of leaving the cursor sitting on a
                      // field with nothing left to type, so scan → scan → scan
                      // flows smoothly without touching the mouse.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        expiryDateRef.current?.focus();
                      }
                    }}
                  />
                </div>
                <div>
                  <Label className="text-xs">Expiry Date *</Label>
                  <Input
                    ref={expiryDateRef}
                    type="date"
                    className="h-9"
                    value={receiveForm.expiryDate}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, expiryDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Purchase Price</Label>
                  <Input
                    type="number"
                    className="h-9"
                    placeholder="0.00"
                    value={receiveForm.purchasePrice}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, purchasePrice: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Selling Price</Label>
                  <Input
                    type="number"
                    className="h-9"
                    placeholder="0.00"
                    value={receiveForm.sellingPrice}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, sellingPrice: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Quantity *</Label>
                  <Input
                    type="number"
                    className="h-9"
                    placeholder="0"
                    value={receiveForm.quantity}
                    onChange={(e) => setReceiveForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </div>
              </div>
              <Button
                className="w-full bg-brand-600 hover:bg-brand-700"
                onClick={handleReceive}
                disabled={receiveMutation.isPending}
              >
                {receiveMutation.isPending ? 'Receiving...' : 'Receive Goods'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Batches Tab */}
      <TabsContent value="batches">
        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b">
              <SearchInput
                className="max-w-sm"
                placeholder="Search by product, batch number, or supplier..."
                value={batchSearch}
                onChange={setBatchSearch}
              />
            </div>
            {batchesError ? (
              <ErrorBanner message={errorMessage(batchesErrorObj)} />
            ) : batchesLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredBatches.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch No.</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Purchase</TableHead>
                      <TableHead>Selling</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Supplier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBatches.map((batch) => {
                      const isExpiringSoon =
                        new Date(batch.expiryDate).getTime() - now < 90 * 24 * 60 * 60 * 1000;
                      return (
                        <TableRow key={batch.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{batch.product?.brandName || `Product #${batch.productId}`}</p>
                              <p className="text-xs text-muted-foreground">{batch.product?.genericName}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{batch.batchNumber}</TableCell>
                          <TableCell>
                            <Badge
                              variant={batch.quantityInStock <= 10 ? 'destructive' : 'secondary'}
                              className="text-xs"
                            >
                              {batch.quantityInStock}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{formatMoney(batch.purchasePrice, baseCurrency)}</TableCell>
                          <TableCell className="text-sm font-medium">{formatMoney(batch.sellingPrice, baseCurrency)}</TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                'text-xs',
                                isExpiringSoon ? 'text-rose-600 font-medium' : 'text-muted-foreground'
                              )}
                            >
                              {format(new Date(batch.expiryDate), 'MMM d, yyyy')}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {batch.supplier?.name || '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Package className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {batchSearch ? `No batches match "${batchSearch}".` : 'No inventory batches found.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Receive Goods Tab */}
      <TabsContent value="receive">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Receive Goods Into Inventory</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Use the &quot;Receive Goods&quot; button above to add new inventory batches to this branch.
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Low Stock Tab */}
      <TabsContent value="low-stock">
        <Card>
          <CardContent className="p-0">
            {lowStockError ? (
              <ErrorBanner message={errorMessage(lowStockErrorObj)} />
            ) : lowStockLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : lowStock.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Reorder Level</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStock.map((item) => (
                      <TableRow key={item.productId}>
                        <TableCell>
                          <p className="font-medium text-sm">{item.brandName}</p>
                          <p className="text-xs text-muted-foreground">{item.genericName}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="text-xs">
                            {item.totalQty}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{item.reorderLevel}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                            Below Reorder
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <AlertTriangle className="h-10 w-10 mx-auto text-brand-200 mb-2" />
                <p className="text-sm text-muted-foreground">All items are above reorder level.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Expiring Soon Tab */}
      <TabsContent value="expiring">
        <Card>
          <CardContent className="p-0">
            {expiringError ? (
              <ErrorBanner message={errorMessage(expiringErrorObj)} />
            ) : expiringLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : expiring.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Days Left</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expiring.map((item) => (
                      <TableRow key={item.batchId}>
                        <TableCell>
                          <p className="font-medium text-sm">{item.brandName}</p>
                          <p className="text-xs text-muted-foreground">{item.genericName}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{item.batchNumber}</TableCell>
                        <TableCell>{item.currentQty}</TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(item.expiryDate), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={item.daysUntilExpiry <= 30 ? 'destructive' : 'outline'}
                            className={cn(
                              'text-xs',
                              item.daysUntilExpiry <= 30
                                ? ''
                                : 'text-amber-600 border-amber-300'
                            )}
                          >
                            {item.daysUntilExpiry} days
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Clock className="h-10 w-10 mx-auto text-brand-200 mb-2" />
                <p className="text-sm text-muted-foreground">No items expiring within 90 days.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
