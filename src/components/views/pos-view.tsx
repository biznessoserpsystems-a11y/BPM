'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePharmacyStore, type PosCartItem } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  ShoppingCart,
  Package,
  AlertCircle,
  History,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash', icon: Banknote },
  { value: 'CARD', label: 'Card', icon: CreditCard },
  { value: 'MOBILE_MONEY', label: 'Mobile Money', icon: Smartphone },
  { value: 'INSURANCE', label: 'Insurance', icon: ShieldCheck },
];

interface Product {
  id: number;
  brandName: string;
  genericName: string;
  skuCode: string;
  category: string;
  dosageForm: string;
  isPrescriptionRequired: boolean;
}

interface Batch {
  id: string;
  batchNumber: string;
  productId: number;
  branchId: string;
  quantityInStock: number;
  sellingPrice: number;
  expiryDate: string;
}

export function PosView() {
  const { selectedBranchId, posCart, addToCart, removeFromCart, updateCartQty, clearCart, user } =
    usePharmacyStore();
  const queryClient = useQueryClient();
  const baseCurrency = useBaseCurrency();
  // See inventory-view.tsx for why this is memoized and why it still
  // shows as a lint warning (not error) rather than a fully clean pass.
  const now = useMemo(() => Date.now(), []);

  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [showReceipt, setShowReceipt] = useState(false);
  const [saleResult, setSaleResult] = useState<Record<string, unknown> | null>(null);
  const [receiptItems, setReceiptItems] = useState<PosCartItem[]>([]);

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ['products-search', search],
    queryFn: () => fetchJson<Product[]>(`/api/v1/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    enabled: search.length > 0,
  });

  const { data: batches = [], isLoading: batchesLoading, isError: batchesError, error: batchesErrorObj } = useQuery<Batch[]>({
    queryKey: ['fefo-batches', selectedBranchId, selectedProductId],
    queryFn: () => fetchJson<Batch[]>(`/api/v1/inventory/fefo?branchId=${selectedBranchId}&productId=${selectedProductId}`),
    enabled: !!selectedProductId,
  });

  const completeSaleMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<Record<string, unknown>>('/api/v1/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      toast.success('Sale completed successfully!');
      setSaleResult(data);
      setReceiptItems(posCart);
      setShowReceipt(true);
      clearCart();
      setCustomerName('');
      setCustomerPhone('');
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['fefo-batches'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-batches'] });
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to complete sale. Please try again.');
    },
  });

  const cartTotal = useMemo(
    () => posCart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [posCart]
  );

  const handleAddToCart = (batch: Batch, product: Product) => {
    const cartItem: PosCartItem = {
      batchId: batch.id,
      productId: product.id,
      brandName: product.brandName,
      genericName: product.genericName,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: 1,
      unitPrice: batch.sellingPrice,
      availableQty: batch.quantityInStock,
    };
    addToCart(cartItem);
    toast.success(`Added ${product.brandName} to cart`);
  };

  const handleCompleteSale = () => {
    if (posCart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    if (!user?.id) {
      toast.error('Your session looks invalid — please log in again');
      return;
    }
    completeSaleMutation.mutate({
      branchId: selectedBranchId,
      userId: user.id,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      paymentMethod,
      items: posCart.map((item) => ({
        productId: item.productId,
        batchId: item.batchId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });
  };

  const selectedProduct = products?.find((p) => p.id === selectedProductId);

  if (showReceipt && saleResult) {
    const result = saleResult as { id: string; totalAmount: number };
    return (
      <div className="max-w-lg mx-auto">
        <Card className="border-brand-200">
          <CardContent className="p-8 text-center space-y-6">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-brand-100 flex items-center justify-center">
                <CheckCircle2 className="h-10 w-10 text-brand-600" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-brand-800">Sale Complete</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Transaction #{String(result.id).slice(0, 8)}
              </p>
            </div>
            <Separator />
            <div className="text-3xl font-bold text-brand-700">
              {formatMoney(result.totalAmount, baseCurrency)}
            </div>
            <Separator />
            <div className="space-y-2 text-sm text-left">
              <p className="font-medium">Items:</p>
              {receiptItems.length > 0 ? (
                receiptItems.map((item) => (
                  <div key={item.batchId} className="flex justify-between">
                    <span>
                      {item.brandName} x{item.quantity}
                    </span>
                    <span>{formatMoney(item.unitPrice * item.quantity, baseCurrency)}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No item details available for this receipt.</p>
              )}
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">Paid via {paymentMethod}</p>
            <Button onClick={() => setShowReceipt(false)} className="bg-brand-600 hover:bg-brand-700">
              New Sale
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Tabs defaultValue="new-sale" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="new-sale" icon={ShoppingCart} label="New Sale" color="brand" />
        <TileTabsTrigger value="history" icon={History} label="Sales History" color="sky" />
      </TileTabsList>

      <TabsContent value="new-sale">
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* Left: Product Search & Batches */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-brand-600" />
              Search Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SearchInput
              placeholder="Search by name, generic name, or SKU..."
              value={search}
              onChange={(v) => {
                setSearch(v);
                setSelectedProductId(null);
              }}
            />

            {search.length > 0 && productsLoading && (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}

            {products.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border">
                {products.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => setSelectedProductId(product.id)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-brand-50 transition-colors border-b last:border-b-0',
                      selectedProductId === product.id && 'bg-brand-50'
                    )}
                  >
                    <div>
                      <p className="font-medium">{product.brandName}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.genericName} &middot; {product.dosageForm}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {product.isPrescriptionRequired && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
                          Rx
                        </Badge>
                      )}
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            )}

            {products.length === 0 && search.length > 0 && !productsLoading && (
              <p className="mt-3 text-sm text-muted-foreground text-center">No products found.</p>
            )}
          </CardContent>
        </Card>

        {/* Available Batches */}
        {selectedProduct && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Available Batches — {selectedProduct.brandName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {batchesError ? (
                <ErrorBanner message={errorMessage(batchesErrorObj)} />
              ) : batchesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : batches.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {batches.map((batch) => {
                    const alreadyInCart = posCart.find((c) => c.batchId === batch.id);
                    const isExpiringSoon =
                      new Date(batch.expiryDate).getTime() - now < 90 * 24 * 60 * 60 * 1000;
                    return (
                      <div
                        key={batch.id}
                        className="flex items-center justify-between rounded-lg border p-3 gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium font-mono px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{batch.batchNumber}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">
                              Qty: {batch.quantityInStock}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Exp: {format(new Date(batch.expiryDate), 'MMM yyyy')}
                            </span>
                            {isExpiringSoon && (
                              <Badge variant="outline" className="text-rose-600 border-rose-300 text-[10px]">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Expiring
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-brand-700">
                            {formatMoney(batch.sellingPrice, baseCurrency)}
                          </span>
                          <Button
                            size="sm"
                            className="bg-brand-600 hover:bg-brand-700 h-8"
                            onClick={() => handleAddToCart(batch, selectedProduct)}
                            disabled={batch.quantityInStock <= 0 || !!alreadyInCart}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {alreadyInCart ? 'Added' : 'Add'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No batches available for this product.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: Cart & Checkout */}
      <Card className="h-fit sticky top-20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-brand-600" />
            Cart
            {posCart.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {posCart.length} item{posCart.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="h-9"
            />
            <Input
              placeholder="Customer phone (optional)"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="h-9"
            />
          </div>

          <Separator />

          {posCart.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingCart className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Cart is empty</p>
              <p className="text-xs text-muted-foreground">Search and add products to begin</p>
            </div>
          ) : (
            <ScrollArea className="max-h-64">
              <div className="space-y-3 pr-2">
                {posCart.map((item) => (
                  <div key={item.batchId} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.brandName}</p>
                        <p className="text-xs text-muted-foreground">{item.genericName}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                        onClick={() => removeFromCart(item.batchId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateCartQty(item.batchId, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateCartQty(item.batchId, item.quantity + 1)}
                          disabled={item.quantity >= item.availableQty}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <span className="text-sm font-bold text-brand-700">
                        {formatMoney(item.unitPrice * item.quantity, baseCurrency)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Batch: {item.batchNumber} &middot; Exp: {format(new Date(item.expiryDate), 'MMM yyyy')} &middot;{' '}
                      {formatMoney(item.unitPrice, baseCurrency)} each
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {posCart.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHODS.map((pm) => (
                      <button
                        key={pm.value}
                        onClick={() => setPaymentMethod(pm.value)}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                          paymentMethod === pm.value
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-border hover:bg-muted'
                        )}
                      >
                        <pm.icon className="h-3.5 w-3.5" />
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-brand-50 p-3">
                  <span className="text-sm font-medium">Total</span>
                  <span className="text-xl font-bold text-brand-700">
                    {formatMoney(cartTotal, baseCurrency)}
                  </span>
                </div>

                <Button
                  className="w-full h-11 bg-brand-600 hover:bg-brand-700 text-white"
                  onClick={handleCompleteSale}
                  disabled={completeSaleMutation.isPending}
                  loading={completeSaleMutation.isPending}
                >
                  {completeSaleMutation.isPending ? 'Processing...' : 'Complete Sale'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
      </TabsContent>

      <TabsContent value="history">
        <SalesHistorySection />
      </TabsContent>
    </Tabs>
  );
}

// =============================================================================
// SALES HISTORY & RETURNS
// =============================================================================

interface SoldItem {
  id: string;
  productId: number;
  batchId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  product?: { brandName: string; genericName: string; skuCode: string };
  salesReturnItems?: { quantity: number }[];
}

interface SaleRecord {
  id: string;
  invoiceNumber: string;
  customerName?: string;
  totalAmount: number;
  paymentMethod: string;
  saleDate: string;
  saleItems: SoldItem[];
  user: { fullName: string };
}

function SalesHistorySection() {
  const { selectedBranchId } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [returnTarget, setReturnTarget] = useState<SaleRecord | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');

  const { data: sales = [], isLoading, isError, error } = useQuery<SaleRecord[]>({
    queryKey: ['sales-history', selectedBranchId],
    queryFn: () => fetchJson<SaleRecord[]>(`/api/v1/sales?branchId=${selectedBranchId}`),
  });

  const filteredSales = sales.filter((s) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      s.invoiceNumber.toLowerCase().includes(q) ||
      (s.customerName?.toLowerCase().includes(q) ?? false)
    );
  });

  const returnMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/v1/sales/${returnTarget?.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Return processed');
      setReturnTarget(null);
      setReturnQty({});
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['sales-history'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remainingReturnable = (item: SoldItem) => {
    const alreadyReturned = (item.salesReturnItems ?? []).reduce((sum, r) => sum + r.quantity, 0);
    return item.quantity - alreadyReturned;
  };

  const handleProcessReturn = () => {
    const items = Object.entries(returnQty)
      .map(([saleItemId, qty]) => ({ saleItemId, quantity: Number(qty) }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error('Enter a quantity for at least one item');
      return;
    }
    returnMutation.mutate({ items, restocked: restock, reason: reason || undefined });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-brand-600" /> Sales History</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="p-4 border-b">
          <SearchInput className="max-w-sm" placeholder="Search by invoice number or customer..." value={search} onChange={setSearch} />
        </div>
        {isError ? (
          <ErrorBanner message={errorMessage(error)} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filteredSales.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Invoice</th>
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Cashier</th>
                  <th className="p-3 font-medium">Payment</th>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium text-right">Total</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((s) => {
                  const anyReturnable = s.saleItems.some((i) => remainingReturnable(i) > 0);
                  return (
                    <tr key={s.id} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="p-3 font-mono text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{s.invoiceNumber}</span>
                      </td>
                      <td className="p-3 text-sm">{s.customerName || 'Walk-in Customer'}</td>
                      <td className="p-3 text-sm text-muted-foreground">{s.user.fullName}</td>
                      <td className="p-3"><Badge variant="outline" className="text-xs">{s.paymentMethod}</Badge></td>
                      <td className="p-3 text-xs text-muted-foreground">{format(new Date(s.saleDate), 'MMM d, yyyy h:mm a')}</td>
                      <td className="p-3 text-sm text-right font-medium">{formatMoney(s.totalAmount, baseCurrency)}</td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={!anyReturnable}
                          onClick={() => { setReturnTarget(s); setReturnQty({}); setRestock(true); setReason(''); }}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Return
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <History className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">{search ? `No sales match "${search}".` : 'No sales recorded yet.'}</p>
          </div>
        )}
      </CardContent>

      <Dialog open={!!returnTarget} onOpenChange={(open) => { if (!open) setReturnTarget(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Process Return — {returnTarget?.invoiceNumber}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Enter the quantity being returned for each item. Leave at 0 for anything not being returned.</p>
            {returnTarget?.saleItems.map((item) => {
              const max = remainingReturnable(item);
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.product?.brandName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {max} of {item.quantity} returnable &middot; {formatMoney(item.unitPrice, baseCurrency)}/unit
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={max}
                    disabled={max <= 0}
                    className="h-8 w-16 text-xs shrink-0"
                    value={returnQty[item.id] ?? ''}
                    onChange={(e) => setReturnQty((q) => ({ ...q, [item.id]: e.target.value }))}
                  />
                </div>
              );
            })}
            <div className="flex items-center gap-2 pt-1">
              <Checkbox id="restock" checked={restock} onCheckedChange={(c) => setRestock(c === true)} />
              <label htmlFor="restock" className="text-xs leading-tight">
                Restock these items (adds them back to sellable inventory and reverses their cost). Leave unchecked for damaged or expired returns.
              </label>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Reason (optional)</label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={returnMutation.isPending} loading={returnMutation.isPending} onClick={handleProcessReturn}>
              {returnMutation.isPending ? 'Processing...' : 'Process Return'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
