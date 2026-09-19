'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TileTabsList, TileTabsTrigger } from '@/components/ui/tile-tabs';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ClipboardList,
  PackageCheck,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  Truck,
  Ban,
  PackagePlus,
  ScanBarcode,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePharmacyStore } from '@/lib/store';
import { formatMoney } from '@/lib/currency';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

// =============================================================================
// TYPES
// =============================================================================

interface Product {
  id: number;
  brandName: string;
  skuCode: string;
}

interface Supplier {
  id: number;
  name: string;
}

interface POItem {
  id: string;
  productId: number;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  taxRate: number;
  subtotal: number;
  product: Product;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  branchId: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  notes?: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  supplier: Supplier;
  requestedByUser: { fullName: string };
  approvedByUser?: { fullName: string };
  items: POItem[];
  goodsReceipts?: GoodsReceipt[];
}

interface GoodsReceipt {
  id: string;
  grnNumber: string;
  receivedDate: string;
  notes?: string;
  journalEntryId?: string;
  purchaseOrder?: { poNumber: string; supplier?: { name: string } };
  receivedByUser: { fullName: string };
  items: {
    id: string;
    quantityReceived: number;
    unitCost: number;
    product: Product;
    batch: { batchNumber: string };
  }[];
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  SUBMITTED: 'bg-sky-100 text-sky-700 border-sky-200',
  APPROVED: 'bg-brand-100 text-brand-700 border-brand-200',
  ORDERED: 'bg-violet-100 text-violet-700 border-violet-200',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-700 border-amber-200',
  RECEIVED: 'bg-teal-100 text-teal-700 border-teal-200',
  CANCELLED: 'bg-rose-100 text-rose-700 border-rose-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-xs ${STATUS_STYLES[status] ?? ''}`}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

const emptyLine = { productId: '', quantityOrdered: '', unitCost: '', taxRate: '0' };

// =============================================================================
// COMPONENT
// =============================================================================

export function ProcurementView() {
  const queryClient = useQueryClient();
  const { user, selectedBranchId } = usePharmacyStore();
  const baseCurrency = useBaseCurrency();
  // Keyed by PO item id, since the receive dialog renders one batch-number
  // field per outstanding line — a single ref can't cover a dynamic list.
  const expiryDateRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [poSearch, setPoSearch] = useState('');

  const { data: purchaseOrders = [], isLoading: poLoading, isError: poError, error: poErrorObj } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', selectedBranchId, statusFilter],
    queryFn: () =>
      fetchJson<PurchaseOrder[]>(
        `/api/v1/purchase-orders?branchId=${selectedBranchId}${statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''}`
      ),
  });

  const filteredPOs = purchaseOrders.filter((po) => {
    const q = poSearch.toLowerCase();
    if (!q) return true;
    return (
      po.poNumber.toLowerCase().includes(q) ||
      po.supplier.name.toLowerCase().includes(q) ||
      po.requestedByUser.fullName.toLowerCase().includes(q)
    );
  });

  const { data: goodsReceipts = [], isLoading: grLoading, isError: grError, error: grErrorObj } = useQuery<GoodsReceipt[]>({
    queryKey: ['goods-receipts', selectedBranchId],
    queryFn: () => fetchJson<GoodsReceipt[]>(`/api/v1/goods-receipts?branchId=${selectedBranchId}`),
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-list-procurement'],
    queryFn: () => fetchJson<Product[]>('/api/v1/products'),
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers-list-procurement'],
    queryFn: () => fetchJson<Supplier[]>('/api/v1/suppliers'),
  });

  const invalidatePO = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
  };

  // ---------------------------------------------------------------------------
  // Create PO
  // ---------------------------------------------------------------------------

  const [createOpen, setCreateOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ ...emptyLine }]);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Purchase order created as draft!');
      setCreateOpen(false);
      setPoSupplierId('');
      setExpectedDeliveryDate('');
      setNotes('');
      setLines([{ ...emptyLine }]);
      invalidatePO();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addLine = () => setLines((ls) => [...ls, { ...emptyLine }]);
  const removeLine = (idx: number) => setLines((ls) => ls.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof typeof emptyLine, value: string) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));

  const draftTotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantityOrdered) || 0;
    const cost = Number(l.unitCost) || 0;
    const tax = Number(l.taxRate) || 0;
    const subtotal = qty * cost;
    return sum + subtotal + subtotal * (tax / 100);
  }, 0);

  const handleCreatePO = () => {
    const validLines = lines.filter((l) => l.productId && Number(l.quantityOrdered) > 0);
    if (!poSupplierId) { toast.error('Select a supplier'); return; }
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    createMutation.mutate({
      branchId: selectedBranchId,
      supplierId: Number(poSupplierId),
      requestedByUserId: user?.id,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      notes: notes || undefined,
      items: validLines.map((l) => ({
        productId: Number(l.productId),
        quantityOrdered: Number(l.quantityOrdered),
        unitCost: Number(l.unitCost) || 0,
        taxRate: Number(l.taxRate) || 0,
      })),
    });
  };

  // ---------------------------------------------------------------------------
  // Workflow actions (submit / approve / mark-ordered / cancel)
  // ---------------------------------------------------------------------------

  const workflowMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) =>
      fetchJson(`/api/v1/purchase-orders/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    onSuccess: (_, vars) => {
      toast.success(`Purchase order ${vars.action.replace('-', ' ')}!`);
      invalidatePO();
      setDetailOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [cancelReason, setCancelReason] = useState('');
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Detail + receive dialog
  // ---------------------------------------------------------------------------

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<
    Record<string, { quantityReceived: string; batchNumber: string; expiryDate: string; sellingPrice: string }>
  >({});

  const openDetail = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setDetailOpen(true);
  };

  const openReceive = (po: PurchaseOrder) => {
    const initial: typeof receiveLines = {};
    po.items
      .filter((i) => i.quantityReceived < i.quantityOrdered)
      .forEach((i) => {
        initial[i.id] = { quantityReceived: '', batchNumber: '', expiryDate: '', sellingPrice: '' };
      });
    setReceiveLines(initial);
    setSelectedPO(po);
    setReceiveOpen(true);
  };

  const receiveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/v1/purchase-orders/${selectedPO?.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Goods received into stock!');
      setReceiveOpen(false);
      setDetailOpen(false);
      invalidatePO();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleReceive = () => {
    if (!selectedPO) return;
    const items = Object.entries(receiveLines)
      .filter(([, l]) => Number(l.quantityReceived) > 0)
      .map(([purchaseOrderItemId, l]) => ({
        purchaseOrderItemId,
        quantityReceived: Number(l.quantityReceived),
        batchNumber: l.batchNumber,
        expiryDate: l.expiryDate,
        sellingPrice: Number(l.sellingPrice),
      }));
    if (items.length === 0) { toast.error('Enter a quantity for at least one line'); return; }
    for (const item of items) {
      if (!item.batchNumber || !item.expiryDate || !item.sellingPrice) {
        toast.error('Every line being received needs a batch number, expiry date, and selling price');
        return;
      }
    }
    receiveMutation.mutate({
      branchId: selectedBranchId,
      receivedByUserId: user?.id,
      items,
    });
  };

  return (
    <Tabs defaultValue="orders" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="orders" icon={ClipboardList} label="Purchase Orders" color="brand" />
        <TileTabsTrigger value="receipts" icon={PackageCheck} label="Goods Receipts" color="teal" />
      </TileTabsList>

      {/* Purchase Orders */}
      <TabsContent value="orders">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-brand-600" /> Purchase Orders
            </CardTitle>
            <div className="flex items-center gap-2">
              <SearchInput
                className="w-48"
                placeholder="Search PO, supplier..."
                value={poSearch}
                onChange={setPoSearch}
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {Object.keys(STATUS_STYLES).map((s) => (
                    <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
                    <Plus className="h-4 w-4 mr-1" /> New Purchase Order
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Supplier *</Label>
                        <Select value={poSupplierId} onValueChange={setPoSupplierId}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                          <SelectContent>
                            {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Expected Delivery</Label>
                        <Input type="date" className="h-9" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Line Items</Label>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add Line</Button>
                      </div>
                      {lines.map((line, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_80px_90px_70px_32px] gap-2 items-center">
                          <Select value={line.productId} onValueChange={(v) => updateLine(idx, 'productId', v)}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Product" /></SelectTrigger>
                            <SelectContent>
                              {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.skuCode} — {p.brandName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input type="number" className="h-9" placeholder="Qty" value={line.quantityOrdered} onChange={(e) => updateLine(idx, 'quantityOrdered', e.target.value)} />
                          <Input type="number" className="h-9" placeholder="Unit cost" value={line.unitCost} onChange={(e) => updateLine(idx, 'unitCost', e.target.value)} />
                          <Input type="number" className="h-9" placeholder="Tax %" value={line.taxRate} onChange={(e) => updateLine(idx, 'taxRate', e.target.value)} />
                          <Button variant="ghost" size="icon" className="h-9 w-9 text-rose-600" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3 text-sm bg-muted/30">
                      <span>Estimated Total (incl. tax)</span>
                      <strong>{formatMoney(draftTotal, baseCurrency)}</strong>
                    </div>

                    <Button className="w-full bg-brand-600 hover:bg-brand-700" disabled={createMutation.isPending} onClick={handleCreatePO}>
                      {createMutation.isPending ? 'Saving...' : 'Save as Draft'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {poError ? (
              <ErrorBanner message={errorMessage(poErrorObj)} />
            ) : poLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : filteredPOs.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPOs.map((po) => (
                      <TableRow key={po.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(po)}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{po.poNumber}</TableCell>
                        <TableCell className="text-sm">{po.supplier.name}</TableCell>
                        <TableCell><StatusBadge status={po.status} /></TableCell>
                        <TableCell className="text-sm">{po.items.length}</TableCell>
                        <TableCell className="text-sm font-medium">{formatMoney(po.totalAmount, baseCurrency)}</TableCell>
                        <TableCell className="text-sm">{po.requestedByUser.fullName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(po.orderDate).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><ClipboardList className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">{poSearch ? `No purchase orders match "${poSearch}".` : 'No purchase orders yet.'}</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Goods Receipts */}
      <TabsContent value="receipts">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><PackageCheck className="h-4 w-4 text-teal-600" /> Goods Receipts (GRN Log)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {grError ? (
              <ErrorBanner message={errorMessage(grErrorObj)} />
            ) : grLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : goodsReceipts.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GRN Number</TableHead>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Received By</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Posted to GL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goodsReceipts.map((gr) => (
                      <TableRow key={gr.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{gr.grnNumber}</TableCell>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{gr.purchaseOrder?.poNumber}</TableCell>
                        <TableCell className="text-sm">{gr.purchaseOrder?.supplier?.name}</TableCell>
                        <TableCell className="text-sm">{gr.items.length}</TableCell>
                        <TableCell className="text-sm">{gr.receivedByUser.fullName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(gr.receivedDate).toLocaleString()}</TableCell>
                        <TableCell>
                          {gr.journalEntryId ? (
                            <Badge className="bg-teal-100 text-teal-700 text-xs">Posted</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Not posted</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center"><PackageCheck className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" /><p className="text-sm text-muted-foreground">No goods received yet.</p></div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* PO Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedPO && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedPO.poNumber} <StatusBadge status={selectedPO.status} />
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Supplier:</span> {selectedPO.supplier.name}</div>
                  <div><span className="text-muted-foreground">Requested by:</span> {selectedPO.requestedByUser.fullName}</div>
                  {selectedPO.approvedByUser && <div><span className="text-muted-foreground">Approved by:</span> {selectedPO.approvedByUser.fullName}</div>}
                  {selectedPO.expectedDeliveryDate && <div><span className="text-muted-foreground">Expected:</span> {new Date(selectedPO.expectedDeliveryDate).toLocaleDateString()}</div>}
                </div>
                {selectedPO.notes && <p className="text-sm text-muted-foreground italic">{selectedPO.notes}</p>}

                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Product</TableHead><TableHead>Ordered</TableHead><TableHead>Received</TableHead><TableHead>Unit Cost</TableHead><TableHead>Subtotal</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedPO.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-sm">{item.product.brandName}</TableCell>
                        <TableCell className="text-sm">{item.quantityOrdered}</TableCell>
                        <TableCell className="text-sm">{item.quantityReceived}</TableCell>
                        <TableCell className="text-sm">{formatMoney(item.unitCost, baseCurrency)}</TableCell>
                        <TableCell className="text-sm">{formatMoney(item.subtotal, baseCurrency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between rounded-md border p-3 text-sm bg-muted/30">
                  <span>Total</span>
                  <strong>{formatMoney(selectedPO.totalAmount, baseCurrency)}</strong>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedPO.status === 'DRAFT' && (
                    <Button size="sm" className="bg-sky-600 hover:bg-sky-700" onClick={() => workflowMutation.mutate({ id: selectedPO.id, action: 'submit' })}>
                      <Send className="h-3.5 w-3.5 mr-1" /> Submit for Approval
                    </Button>
                  )}
                  {selectedPO.status === 'SUBMITTED' && (
                    <Button size="sm" className="bg-brand-600 hover:bg-brand-700" onClick={() => workflowMutation.mutate({ id: selectedPO.id, action: 'approve', body: { approvedByUserId: user?.id } })}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                  )}
                  {selectedPO.status === 'APPROVED' && (
                    <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => workflowMutation.mutate({ id: selectedPO.id, action: 'mark-ordered' })}>
                      <Truck className="h-3.5 w-3.5 mr-1" /> Mark as Ordered
                    </Button>
                  )}
                  {['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status) && (
                    <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => openReceive(selectedPO)}>
                      <PackagePlus className="h-3.5 w-3.5 mr-1" /> Receive Goods
                    </Button>
                  )}
                  {['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-600 border-rose-300 hover:bg-rose-50"
                      onClick={() => setCancelTargetId(selectedPO.id)}
                    >
                      <Ban className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  )}
                </div>

                {cancelTargetId === selectedPO.id && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-2">
                    <Label className="text-xs">Reason for cancellation *</Label>
                    <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={workflowMutation.isPending}
                        onClick={() => {
                          if (!cancelReason.trim()) { toast.error('A reason is required'); return; }
                          workflowMutation.mutate({ id: selectedPO.id, action: 'cancel', body: { cancelledByUserId: user?.id, reason: cancelReason } });
                          setCancelTargetId(null);
                          setCancelReason('');
                        }}
                      >
                        Confirm Cancellation
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCancelTargetId(null)}>Never mind</Button>
                    </div>
                  </div>
                )}

                {selectedPO.goodsReceipts && selectedPO.goodsReceipts.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Receipt History</p>
                    <div className="space-y-2">
                      {selectedPO.goodsReceipts.map((gr) => (
                        <div key={gr.id} className="text-xs border rounded-md p-2 flex items-center justify-between">
                          <span className="font-mono">{gr.grnNumber}</span>
                          <span className="text-muted-foreground">{gr.receivedByUser.fullName} · {new Date(gr.receivedDate).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Goods dialog */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Receive Goods — {selectedPO?.poNumber}</DialogTitle></DialogHeader>
          {selectedPO && (
            <div className="space-y-4">
              {selectedPO.items
                .filter((i) => i.quantityReceived < i.quantityOrdered)
                .map((item) => {
                  const remaining = item.quantityOrdered - item.quantityReceived;
                  const line = receiveLines[item.id] ?? { quantityReceived: '', batchNumber: '', expiryDate: '', sellingPrice: '' };
                  return (
                    <div key={item.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{item.product.brandName}</span>
                        <span className="text-muted-foreground text-xs">{remaining} of {item.quantityOrdered} outstanding</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <Label className="text-[10px]">Qty received</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            max={remaining}
                            value={line.quantityReceived}
                            onChange={(e) => setReceiveLines((ls) => ({ ...ls, [item.id]: { ...line, quantityReceived: e.target.value } }))}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] flex items-center gap-1">
                            Batch number <ScanBarcode className="h-2.5 w-2.5 text-muted-foreground" />
                          </Label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="Scan or type"
                            value={line.batchNumber}
                            onChange={(e) => setReceiveLines((ls) => ({ ...ls, [item.id]: { ...line, batchNumber: e.target.value } }))}
                            onKeyDown={(e) => {
                              // Same scanner-friendly Enter-to-advance as the
                              // standalone Inventory receive form — moves
                              // focus to this row's expiry date field instead
                              // of leaving the cursor stranded after a scan.
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                expiryDateRefs.current[item.id]?.focus();
                              }
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Expiry date</Label>
                          <Input
                            ref={(el) => { expiryDateRefs.current[item.id] = el; }}
                            type="date"
                            className="h-8 text-xs"
                            value={line.expiryDate}
                            onChange={(e) => setReceiveLines((ls) => ({ ...ls, [item.id]: { ...line, expiryDate: e.target.value } }))}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Selling price</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs"
                            value={line.sellingPrice}
                            onChange={(e) => setReceiveLines((ls) => ({ ...ls, [item.id]: { ...line, sellingPrice: e.target.value } }))}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              <Button className="w-full bg-teal-600 hover:bg-teal-700" disabled={receiveMutation.isPending} onClick={handleReceive}>
                {receiveMutation.isPending ? 'Receiving...' : 'Confirm Receipt'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
