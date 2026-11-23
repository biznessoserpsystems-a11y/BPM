'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePharmacyStore } from '@/lib/store';
import { fetchJson } from '@/lib/fetch-json';
import { formatMoney, type CurrencyInfo } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_BASE_UNIT, type UnitSetup } from '@/lib/receive-units';

export interface ActionBatch {
  id: string;
  batchNumber: string;
  productId: number;
  branchId: string;
  quantityInStock: number;
  purchasePrice: number;
  sellingPrice: number;
  expiryDate: string;
  supplierId?: number | null;
  product?: { brandName: string; genericName: string; skuCode: string };
}

const NO_SUPPLIER = '__none__';

function refreshInventory(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('inventory') });
  queryClient.invalidateQueries({ queryKey: ['warehouse'] });
}

// ---------------------------------------------------------------------------
// Edit a received batch
// ---------------------------------------------------------------------------

export function EditBatchDialog({
  batch,
  suppliers,
  canEditDetails,
  canEditExpiry,
  onClose,
}: {
  batch: ActionBatch;
  suppliers: { id: number; name: string }[];
  canEditDetails: boolean;
  canEditExpiry: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const originalExpiry = batch.expiryDate.slice(0, 10);
  const [batchNumber, setBatchNumber] = useState(batch.batchNumber);
  const [supplier, setSupplier] = useState(batch.supplierId ? String(batch.supplierId) : NO_SUPPLIER);
  const [purchasePrice, setPurchasePrice] = useState(String(batch.purchasePrice));
  const [sellingPrice, setSellingPrice] = useState(String(batch.sellingPrice));
  const [expiry, setExpiry] = useState(originalExpiry);
  const [reason, setReason] = useState('');

  const expiryChanged = expiry !== originalExpiry;

  // Send only what actually changed, so someone who may edit prices isn't
  // blocked by a field they never touched.
  const changes: Record<string, unknown> = {};
  if (batchNumber.trim() !== batch.batchNumber) changes.batchNumber = batchNumber;
  if ((supplier === NO_SUPPLIER ? null : Number(supplier)) !== (batch.supplierId ?? null)) {
    changes.supplierId = supplier === NO_SUPPLIER ? null : Number(supplier);
  }
  if (purchasePrice.trim() !== '' && Number(purchasePrice) !== batch.purchasePrice) changes.purchasePrice = Number(purchasePrice);
  if (sellingPrice.trim() !== '' && Number(sellingPrice) !== batch.sellingPrice) changes.sellingPrice = Number(sellingPrice);
  if (expiryChanged) {
    changes.expiryDate = expiry;
    changes.reason = reason;
  }

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/v1/inventory/batches/${batch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      }),
    onSuccess: () => {
      toast.success('Batch updated');
      refreshInventory(queryClient);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nothingChanged = Object.keys(changes).length === 0;
  const needsReason = expiryChanged && reason.trim().length < 3;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit batch — {batch.product?.brandName ?? `Product #${batch.productId}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Batch number</Label>
            <Input className="h-9" value={batchNumber} disabled={!canEditDetails} onChange={(e) => setBatchNumber(e.target.value)} />
          </div>

          <div>
            <Label className="text-xs">Supplier</Label>
            <Select value={supplier} onValueChange={setSupplier} disabled={!canEditDetails}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUPPLIER}>No supplier</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Purchase price (per unit)</Label>
              <Input type="number" min={0} step="any" className="h-9" value={purchasePrice} disabled={!canEditDetails} onChange={(e) => setPurchasePrice(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Selling price (per unit)</Label>
              <Input type="number" min={0} step="any" className="h-9" value={sellingPrice} disabled={!canEditDetails} onChange={(e) => setSellingPrice(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Expiry date</Label>
            <Input type="date" className="h-9" value={expiry} disabled={!canEditExpiry} onChange={(e) => setExpiry(e.target.value)} />
            {!canEditExpiry && (
              <p className="text-[11px] text-muted-foreground mt-1">You don&apos;t have permission to change expiry dates. Ask an administrator.</p>
            )}
          </div>

          {expiryChanged && (
            <div>
              <Label className="text-xs">Reason for changing the expiry date *</Label>
              <Input
                className="h-9"
                placeholder="e.g. Label misread when receiving"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Recorded in the audit log with the old and new date.</p>
            </div>
          )}

          {!canEditDetails && (
            <p className="text-[11px] text-muted-foreground">You don&apos;t have permission to edit batch details. Ask an administrator.</p>
          )}

          <p className="rounded bg-muted/50 border px-2 py-1.5 text-[11px] text-muted-foreground">
            In stock: <span className="font-medium">{batch.quantityInStock}</span>. To change the quantity, use{' '}
            <span className="font-medium">Adjust stock</span> — it records who changed it and why.
          </p>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-brand-600 hover:bg-brand-700"
              disabled={mutation.isPending || nothingChanged || needsReason}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Adjust stock
// ---------------------------------------------------------------------------

const REASONS = [
  'Damaged',
  'Expired — written off',
  'Lost or stolen',
  'Returned to supplier',
  'Recount — found extra',
  'Recount — shortage',
  'Other',
];

export function AdjustStockDialog({
  batch,
  baseCurrency,
  onClose,
}: {
  batch: ActionBatch;
  baseCurrency: CurrencyInfo | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = usePharmacyStore();
  const [mode, setMode] = useState<'remove' | 'add'>('remove');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState('');

  // Stock is counted in the product's base unit — say which.
  const { data: setup } = useQuery<UnitSetup>({
    queryKey: ['product-units', batch.productId],
    queryFn: () => fetchJson<UnitSetup>(`/api/v1/product-units?productId=${batch.productId}`),
  });
  const unit = setup?.baseUnit ?? DEFAULT_BASE_UNIT;

  const qty = Number(quantity);
  const validQty = quantity.trim() !== '' && Number.isInteger(qty) && qty > 0;
  const signed = mode === 'add' ? qty : -qty;
  const tooMany = mode === 'remove' && validQty && qty > batch.quantityInStock;
  const after = validQty && !tooMany ? batch.quantityInStock + signed : null;

  const mutation = useMutation({
    mutationFn: () =>
      fetchJson('/api/v1/stock-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: batch.branchId,
          batchId: batch.id,
          productId: batch.productId,
          userId: user?.id,
          quantityChanged: signed,
          reason,
          notes: notes.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success(mode === 'add' ? `Added ${qty} ${unit}` : `Removed ${qty} ${unit}`);
      refreshInventory(queryClient);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock — {batch.product?.brandName ?? `Product #${batch.productId}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Batch <span className="font-mono">{batch.batchNumber}</span> · currently{' '}
            <span className="font-medium text-foreground">
              {batch.quantityInStock} {unit}
            </span>{' '}
            in stock
          </p>

          <div className="grid grid-cols-2 gap-2">
            {(['remove', 'add'] as const).map((m) => (
              <Button
                key={m}
                type="button"
                variant={mode === m ? 'default' : 'outline'}
                className={cn('h-9', mode === m && 'bg-brand-600 hover:bg-brand-700')}
                onClick={() => setMode(m)}
              >
                {m === 'remove' ? 'Remove stock' : 'Add stock'}
              </Button>
            ))}
          </div>

          <div>
            <Label className="text-xs">Quantity ({unit})</Label>
            <Input type="number" min={1} step={1} className="h-9" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            {tooMany && <p className="text-xs text-rose-600 mt-1">Only {batch.quantityInStock} in stock — you can&apos;t remove {qty}.</p>}
          </div>

          <div>
            <Label className="text-xs">Reason *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Input className="h-9" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {after !== null && (
            <div className="rounded bg-muted/50 border px-2 py-1.5 text-xs space-y-0.5">
              <p>
                <span className="font-medium">
                  {batch.quantityInStock} → {after} {unit}
                </span>
              </p>
              {mode === 'remove' && batch.purchasePrice > 0 && (
                <p className="text-muted-foreground">
                  A write-down of {formatMoney(qty * batch.purchasePrice, baseCurrency)} (at cost) is posted to the books.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-brand-600 hover:bg-brand-700"
              disabled={mutation.isPending || !validQty || tooMany || !user?.id}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Saving…' : mode === 'add' ? 'Add stock' : 'Remove stock'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
