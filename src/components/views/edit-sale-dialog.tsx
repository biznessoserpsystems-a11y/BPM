'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/fetch-json';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { computeTotals, PAYMENT_METHODS } from '@/lib/sale-edit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface EditableSale {
  id: string;
  invoiceNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  doctorName?: string | null;
  paymentMethod: string;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  saleDate: string;
  saleItems: {
    id: string;
    quantity: number;
    unitPrice: number;
    product?: { brandName: string };
    salesReturnItems?: { quantity: number }[];
  }[];
}

const PAYMENT_LABELS: Record<string, string> = { CASH: 'Cash', CARD: 'Card', MOBILE_MONEY: 'Mobile Money', INSURANCE: 'Insurance' };

/**
 * Edit a recorded sale (today's or an earlier day's). The server decides who
 * may, fixes stock, corrects the books and records the reason — this form just
 * collects the changes and shows the new total before saving.
 */
export function EditSaleDialog({ sale, onClose }: { sale: EditableSale | null; onClose: () => void }) {
  const baseCurrency = useBaseCurrency();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [lines, setLines] = useState<Record<string, { quantity: string; unitPrice: string }>>({});
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!sale) return;
    setCustomerName(sale.customerName ?? '');
    setCustomerPhone(sale.customerPhone ?? '');
    setDoctorName(sale.doctorName ?? '');
    setPaymentMethod(sale.paymentMethod);
    setDiscount(String(sale.discountAmount ?? 0));
    setTax(String(sale.taxAmount ?? 0));
    setLines(Object.fromEntries(sale.saleItems.map((i) => [i.id, { quantity: String(i.quantity), unitPrice: String(i.unitPrice) }])));
    setReason('');
  }, [sale]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/v1/sales/${sale?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success('Sale updated');
      queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      queryClient.invalidateQueries({ queryKey: ['weekly-sales'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!sale) return null;

  const returned = (i: EditableSale['saleItems'][number]) => (i.salesReturnItems ?? []).reduce((n, r) => n + r.quantity, 0);
  const parsed = sale.saleItems.map((i) => ({
    quantity: Number(lines[i.id]?.quantity ?? i.quantity),
    unitPrice: Number(lines[i.id]?.unitPrice ?? i.unitPrice),
  }));
  let newTotal: number | null = null;
  try {
    newTotal = computeTotals(parsed, Number(discount) || 0, Number(tax) || 0).totalAmount;
  } catch {
    newTotal = null;
  }

  const save = () => {
    if (reason.trim().length < 3) return toast.error('Give a reason for the change');
    mutation.mutate({
      reason: reason.trim(),
      customerName,
      customerPhone,
      doctorName,
      paymentMethod,
      discountAmount: Number(discount) || 0,
      taxAmount: Number(tax) || 0,
      items: sale.saleItems.map((i) => ({ id: i.id, quantity: Number(lines[i.id]?.quantity), unitPrice: Number(lines[i.id]?.unitPrice) })),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Sale — {sale.invoiceNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Customer</Label>
              <Input className="h-8 text-sm" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input className="h-8 text-sm" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Doctor</Label>
              <Input className="h-8 text-sm" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{PAYMENT_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Correct quantities and prices. A product can&apos;t be removed here — process a return for that.
            </p>
            {sale.saleItems.map((i) => (
              <div key={i.id} className="grid grid-cols-[1fr_5rem_6rem] items-end gap-2 rounded-lg border p-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{i.product?.brandName}</p>
                  {returned(i) > 0 && <p className="text-[10px] text-rose-600">{returned(i)} already returned</p>}
                </div>
                <div>
                  <Label className="text-[10px]">Qty</Label>
                  <Input
                    type="number" min={Math.max(1, returned(i))} className="h-8 text-xs"
                    value={lines[i.id]?.quantity ?? ''}
                    onChange={(e) => setLines((l) => ({ ...l, [i.id]: { ...l[i.id], quantity: e.target.value } }))}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Unit price</Label>
                  <Input
                    type="number" min={0} step="0.01" className="h-8 text-xs"
                    value={lines[i.id]?.unitPrice ?? ''}
                    onChange={(e) => setLines((l) => ({ ...l, [i.id]: { ...l[i.id], unitPrice: e.target.value } }))}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Discount</Label>
              <Input type="number" min={0} step="0.01" className="h-8 text-sm" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Tax</Label>
              <Input type="number" min={0} step="0.01" className="h-8 text-sm" value={tax} onChange={(e) => setTax(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Total was {formatMoney(sale.totalAmount, baseCurrency)}</span>
            <span className="font-semibold">{newTotal === null ? 'Check the amounts' : `Now ${formatMoney(newTotal, baseCurrency)}`}</span>
          </div>

          <div>
            <Label className="text-xs">Reason for the change (required)</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong quantity entered at the till" />
            <p className="text-[11px] text-muted-foreground mt-1">
              Stock and the accounts are corrected to match, and the before-and-after is kept in the Audit Log.
            </p>
          </div>

          <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={mutation.isPending || newTotal === null} loading={mutation.isPending} onClick={save}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
