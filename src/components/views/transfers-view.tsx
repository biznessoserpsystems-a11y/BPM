'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePharmacyStore } from '@/lib/store';
import { useBranches, useAllBranches } from '@/hooks/use-branches';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
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
import { ArrowLeftRight, Plus, CheckCircle2, Truck, PackageCheck, XCircle, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

interface Transfer {
  id: string;
  sourceBranchId: string;
  destinationBranchId: string;
  productId: number;
  product?: { brandName: string; genericName: string };
  requestedQty: number;
  approvedQty?: number;
  status: string;
  sourceBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Product {
  id: number;
  brandName: string;
  genericName: string;
}

const statusConfig: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  REQUESTED: { color: 'bg-amber-50 text-amber-700 border-amber-200', icon: ArrowLeftRight },
  APPROVED: { color: 'bg-sky-50 text-sky-700 border-sky-200', icon: CheckCircle2 },
  DISPATCHED: { color: 'bg-purple-50 text-purple-700 border-purple-200', icon: Truck },
  RECEIVED: { color: 'bg-brand-50 text-brand-700 border-brand-200', icon: PackageCheck },
  REJECTED: { color: 'bg-gray-50 text-gray-500 border-gray-200', icon: XCircle },
  CANCELLED: { color: 'bg-gray-50 text-gray-500 border-gray-200', icon: Ban },
};

export function TransfersView() {
  const { selectedBranchId, user } = usePharmacyStore();
  const { branches } = useBranches();
  const { data: allBranches = [] } = useAllBranches();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [approveForm, setApproveForm] = useState({ sourceBatchId: '', approvedQty: '' });
  const [form, setForm] = useState({
    destinationBranchId: '',
    productId: '',
    requestedQty: '',
  });

  const { data: transfers = [], isLoading, isError, error } = useQuery<Transfer[]>({
    queryKey: ['transfers', selectedBranchId],
    queryFn: () => fetchJson<Transfer[]>(`/api/v1/transfers?branchId=${selectedBranchId}`),
  });

  const filteredTransfers = transfers.filter((t) => {
    const q = transferSearch.toLowerCase();
    if (!q) return true;
    return (
      (t.product?.brandName.toLowerCase().includes(q) ?? false) ||
      (t.product?.genericName.toLowerCase().includes(q) ?? false) ||
      t.status.toLowerCase().includes(q) ||
      t.destinationBranchId.toLowerCase().includes(q) ||
      t.sourceBranchId.toLowerCase().includes(q)
    );
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-list-transfer'],
    queryFn: () => fetchJson<Product[]>('/api/v1/products'),
  });

  const { data: sourceBatches = [] } = useQuery<unknown[]>({
    queryKey: ['source-batches', selectedBranchId, selectedTransfer?.productId],
    queryFn: () =>
      fetchJson<unknown[]>(`/api/v1/inventory/fefo?branchId=${selectedBranchId}&productId=${selectedTransfer?.productId}`),
    enabled: !!selectedTransfer && approveOpen,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Transfer request created!');
      setCreateOpen(false);
      setForm({ destinationBranchId: '', productId: '', requestedQty: '' });
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body: Record<string, unknown> }) =>
      fetchJson(`/api/v1/transfers/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, variables) => {
      toast.success(`Transfer ${variables.action} successfully!`);
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      if (variables.action === 'approve') setApproveOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.destinationBranchId || !form.productId || !form.requestedQty) {
      toast.error('Please fill in all fields');
      return;
    }
    if (!user?.id) {
      toast.error('Your session looks invalid — please log in again');
      return;
    }
    createMutation.mutate({
      sourceBranchId: selectedBranchId,
      destinationBranchId: form.destinationBranchId,
      productId: Number(form.productId),
      requestedQty: Number(form.requestedQty),
      requestedByUserId: user.id,
    });
  };

  const handleApprove = () => {
    if (!selectedTransfer || !approveForm.sourceBatchId || !approveForm.approvedQty) {
      toast.error('Please select a batch and enter quantity');
      return;
    }
    if (!user?.id) {
      toast.error('Your session looks invalid — please log in again');
      return;
    }
    actionMutation.mutate({
      id: selectedTransfer.id,
      action: 'approve',
      body: {
        sourceBatchId: approveForm.sourceBatchId,
        approvedQty: Number(approveForm.approvedQty),
        approvedByUserId: user.id,
      },
    });
  };

  const getBranchLabel = (id: string) => allBranches.find((b) => b.id === id)?.name || id;

  // Shared guard for the inline status-action buttons below (dispatch,
  // receive, reject, cancel) — same "who is this really as" check as
  // handleCreate/handleApprove, just factored out since four separate
  // buttons need it inline rather than behind a form-validation flow.
  const requireUserId = (): number | null => {
    if (!user?.id) {
      toast.error('Your session looks invalid — please log in again');
      return null;
    }
    return user.id;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
              <Plus className="h-4 w-4 mr-1" /> New Transfer Request
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Transfer Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                Source: <span className="font-medium text-foreground">{getBranchLabel(selectedBranchId)}</span>
              </div>
              <div>
                <Label className="text-xs">Destination Branch *</Label>
                <Select value={form.destinationBranchId} onValueChange={(v) => setForm((f) => ({ ...f, destinationBranchId: v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.filter((b) => b.id !== selectedBranchId).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Product *</Label>
                <Select value={form.productId} onValueChange={(v) => setForm((f) => ({ ...f, productId: v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.brandName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Requested Quantity *</Label>
                <Input type="number" className="h-9" placeholder="0" value={form.requestedQty} onChange={(e) => setForm((f) => ({ ...f, requestedQty: e.target.value }))} />
              </div>
              <Button className="w-full bg-brand-600 hover:bg-brand-700" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Submit Request'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-brand-600" />
            Transfer Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <SearchInput
              className="max-w-sm"
              placeholder="Search by product, status, or branch..."
              value={transferSearch}
              onChange={setTransferSearch}
            />
          </div>
          {isError ? (
            <ErrorBanner message={errorMessage(error)} />
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredTransfers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransfers.map((t) => {
                    const cfg = statusConfig[t.status] || statusConfig.REQUESTED;
                    const StatusIcon = cfg.icon;
                    const isSource = t.sourceBranchId === selectedBranchId;
                    const isDest = t.destinationBranchId === selectedBranchId;
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{t.id.slice(0, 8)}</TableCell>
                        <TableCell className="text-sm font-medium">{t.product?.brandName || `#${t.productId}`}</TableCell>
                        <TableCell className="text-xs">{getBranchLabel(t.sourceBranchId)}</TableCell>
                        <TableCell className="text-xs">{getBranchLabel(t.destinationBranchId)}</TableCell>
                        <TableCell className="text-sm">
                          {t.approvedQty != null ? (
                            <span>{t.approvedQty}/{t.requestedQty}</span>
                          ) : (
                            <span>{t.requestedQty}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-xs gap-1', cfg.color)}>
                            <StatusIcon className="h-3 w-3" />
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(t.createdAt), 'MMM d')}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {t.status === 'REQUESTED' && isSource && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-sky-600 hover:text-sky-700 border-sky-200"
                                onClick={() => {
                                  setSelectedTransfer(t);
                                  setApproveOpen(true);
                                  setApproveForm({ sourceBatchId: '', approvedQty: String(t.requestedQty) });
                                }}
                              >
                                Approve
                              </Button>
                            )}
                            {t.status === 'APPROVED' && isSource && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-purple-600 hover:text-purple-700 border-purple-200"
                                onClick={() => { const uid = requireUserId(); if (uid) actionMutation.mutate({ id: t.id, action: 'dispatch', body: { userId: uid } }); }}
                                disabled={actionMutation.isPending}
                              >
                                Dispatch
                              </Button>
                            )}
                            {t.status === 'DISPATCHED' && isDest && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-brand-600 hover:text-brand-700 border-brand-200"
                                onClick={() => { const uid = requireUserId(); if (uid) actionMutation.mutate({ id: t.id, action: 'receive', body: { userId: uid } }); }}
                                disabled={actionMutation.isPending}
                              >
                                Receive
                              </Button>
                            )}
                            {(t.status === 'REQUESTED') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-rose-600 hover:text-rose-700"
                                onClick={() => { const uid = requireUserId(); if (uid) actionMutation.mutate({ id: t.id, action: 'reject', body: { userId: uid } }); }}
                                disabled={actionMutation.isPending}
                              >
                                Reject
                              </Button>
                            )}
                            {t.status === 'REQUESTED' && isSource && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-muted-foreground"
                                onClick={() => { const uid = requireUserId(); if (uid) actionMutation.mutate({ id: t.id, action: 'cancel', body: { userId: uid } }); }}
                                disabled={actionMutation.isPending}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <ArrowLeftRight className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                {transferSearch ? `No transfers match "${transferSearch}".` : 'No transfer requests found.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Transfer</DialogTitle>
          </DialogHeader>
          {selectedTransfer && (
            <div className="space-y-3">
              <div className="text-sm bg-muted rounded-lg p-3 space-y-1">
                <p><span className="text-muted-foreground">Product:</span> {selectedTransfer.product?.brandName}</p>
                <p><span className="text-muted-foreground">Requested:</span> {selectedTransfer.requestedQty} units</p>
              </div>
              <div>
                <Label className="text-xs">Select Source Batch *</Label>
                <Select value={approveForm.sourceBatchId} onValueChange={(v) => setApproveForm((f) => ({ ...f, sourceBatchId: v }))}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sourceBatches as Array<{ id: string; batchNumber: string; quantityInStock: number; expiryDate: string }>)?.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.batchNumber} (Qty: {b.quantityInStock}, Exp: {format(new Date(b.expiryDate), 'MMM yyyy')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Approved Quantity *</Label>
                <Input type="number" className="h-9" value={approveForm.approvedQty} onChange={(e) => setApproveForm((f) => ({ ...f, approvedQty: e.target.value }))} />
              </div>
              <Button className="w-full bg-sky-600 hover:bg-sky-700" onClick={handleApprove} disabled={actionMutation.isPending}>
                {actionMutation.isPending ? 'Approving...' : 'Approve Transfer'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
