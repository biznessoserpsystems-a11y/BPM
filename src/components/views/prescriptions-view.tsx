'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Plus, FileText, Eye, X, Pencil, Trash2, Ban, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { usePharmacyStore } from '@/lib/store';

interface Prescription {
  rxNumber: string;
  patientName: string;
  patientPhone?: string;
  doctorName: string;
  doctorLicenseNumber: string;
  status: string;
  createdAt: string;
  expiryDate: string;
  notes?: string;
  items?: PrescriptionItem[];
}

interface PrescriptionItem {
  id: string;
  productId: number;
  product?: { brandName: string; genericName: string };
  dosageInstructions: string;
  refillsAuthorized: number;
  refillsRemaining: number;
  quantityPerRefill: number;
  intervalDays?: number;
  refillLogs?: { id: string }[];
}

interface Product {
  id: number;
  brandName: string;
  genericName: string;
}

interface NewRxItem {
  productId: string;
  dosageInstructions: string;
  refillsAuthorized: string;
  quantityPerRefill: string;
  intervalDays: string;
}

export function PrescriptionsView() {
  const queryClient = useQueryClient();
  const { user } = usePharmacyStore();
  const canEdit = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER' || user?.roleName === 'EMPLOYEE';
  const canDelete = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';
  const [createOpen, setCreateOpen] = useState(false);
  const [rxSearch, setRxSearch] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRx, setSelectedRx] = useState<Prescription | null>(null);
  const [isEditingRx, setIsEditingRx] = useState(false);
  const [rxEditForm, setRxEditForm] = useState({
    patientName: '', patientPhone: '', doctorName: '', doctorLicenseNumber: '', expiryDate: '', notes: '',
  });
  const [itemEditForm, setItemEditForm] = useState<Record<string, { dosageInstructions: string; refillsAuthorized: string; quantityPerRefill: string; intervalDays: string }>>({});
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rxItems, setRxItems] = useState<NewRxItem[]>([{ productId: '', dosageInstructions: '', refillsAuthorized: '0', quantityPerRefill: '30', intervalDays: '30' }]);
  const [form, setForm] = useState({
    patientName: '',
    patientPhone: '',
    doctorName: '',
    doctorLicenseNumber: '',
    expiryDate: '',
    notes: '',
  });

  const { data: prescriptions = [], isLoading, isError, error } = useQuery<Prescription[]>({
    queryKey: ['prescriptions'],
    queryFn: () => fetchJson<Prescription[]>('/api/v1/prescriptions'),
  });

  const filteredPrescriptions = prescriptions.filter((rx) => {
    const q = rxSearch.toLowerCase();
    if (!q) return true;
    return (
      rx.rxNumber.toLowerCase().includes(q) ||
      rx.patientName.toLowerCase().includes(q) ||
      rx.doctorName.toLowerCase().includes(q) ||
      (rx.patientPhone?.toLowerCase().includes(q) ?? false)
    );
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-list-rx'],
    queryFn: () => fetchJson<Product[]>('/api/v1/products'),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson('/api/v1/prescriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Prescription created successfully!');
      setCreateOpen(false);
      setForm({ patientName: '', patientPhone: '', doctorName: '', doctorLicenseNumber: '', expiryDate: '', notes: '' });
      setRxItems([{ productId: '', dosageInstructions: '', refillsAuthorized: '0', quantityPerRefill: '30', intervalDays: '30' }]);
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: detailData } = useQuery<Prescription>({
    queryKey: ['prescription-detail', selectedRx?.rxNumber],
    queryFn: () => fetchJson<Prescription>(`/api/v1/prescriptions/${selectedRx?.rxNumber}`),
    enabled: !!selectedRx && detailOpen,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/v1/prescriptions/${selectedRx?.rxNumber}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success('Prescription updated!');
      setIsEditingRx(false);
      queryClient.invalidateQueries({ queryKey: ['prescription-detail'] });
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelRxMutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/v1/prescriptions/${selectedRx?.rxNumber}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELLED' }),
      }),
    onSuccess: () => {
      toast.success('Prescription cancelled');
      queryClient.invalidateQueries({ queryKey: ['prescription-detail'] });
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => fetchJson(`/api/v1/prescriptions/${selectedRx?.rxNumber}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Prescription deleted');
      setDeleteConfirmOpen(false);
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteConfirmOpen(false);
    },
  });

  const startEditingRx = () => {
    if (!detailData) return;
    setRxEditForm({
      patientName: detailData.patientName,
      patientPhone: detailData.patientPhone || '',
      doctorName: detailData.doctorName,
      doctorLicenseNumber: detailData.doctorLicenseNumber,
      expiryDate: detailData.expiryDate.slice(0, 10),
      notes: detailData.notes || '',
    });
    const items: typeof itemEditForm = {};
    for (const item of detailData.items || []) {
      items[item.id] = {
        dosageInstructions: item.dosageInstructions,
        refillsAuthorized: String(item.refillsAuthorized),
        quantityPerRefill: String(item.quantityPerRefill),
        intervalDays: String(item.intervalDays ?? 30),
      };
    }
    setItemEditForm(items);
    setIsEditingRx(true);
  };

  const handleSaveEdit = () => {
    if (!rxEditForm.patientName || !rxEditForm.doctorName || !rxEditForm.doctorLicenseNumber || !rxEditForm.expiryDate) {
      toast.error('Patient name, doctor name, license number, and expiry date are required');
      return;
    }
    updateMutation.mutate({
      ...rxEditForm,
      items: Object.entries(itemEditForm).map(([id, f]) => ({
        id,
        dosageInstructions: f.dosageInstructions,
        refillsAuthorized: Number(f.refillsAuthorized),
        quantityPerRefill: Number(f.quantityPerRefill),
        intervalDays: Number(f.intervalDays),
      })),
    });
  };

  const handleCreate = () => {
    if (!form.patientName || !form.doctorName || !form.doctorLicenseNumber || !form.expiryDate) {
      toast.error('Please fill in all required fields');
      return;
    }
    const validItems = rxItems.filter((i) => i.productId);
    if (validItems.length === 0) {
      toast.error('Please add at least one medication');
      return;
    }
    createMutation.mutate({
      ...form,
      items: validItems.map((i) => ({
        productId: Number(i.productId),
        dosageInstructions: i.dosageInstructions,
        refillsAuthorized: Number(i.refillsAuthorized),
        quantityPerRefill: Number(i.quantityPerRefill),
        intervalDays: Number(i.intervalDays) || undefined,
      })),
    });
  };

  const addRxItem = () => {
    setRxItems([...rxItems, { productId: '', dosageInstructions: '', refillsAuthorized: '0', quantityPerRefill: '30', intervalDays: '30' }]);
  };

  const removeRxItem = (index: number) => {
    setRxItems(rxItems.filter((_, i) => i !== index));
  };

  const updateRxItem = (index: number, field: keyof NewRxItem, value: string) => {
    setRxItems(rxItems.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-brand-50 text-brand-700 border-brand-200';
      case 'EXPIRED': return 'bg-gray-50 text-gray-600 border-gray-200';
      case 'COMPLETED': return 'bg-gray-50 text-gray-600 border-gray-200';
      case 'DISCONTINUED': return 'bg-rose-50 text-rose-600 border-rose-200';
      default: return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  };

  // The real, stored status is just ACTIVE/CANCELLED (see PATCH
  // /api/v1/prescriptions/[rxNumber]) — this derives the richer four-way
  // badge (also recognizing an active Rx that's simply expired, or one
  // where every refill has already been used) without needing to store
  // those as separate persisted states.
  const displayStatus = (rx: Prescription): string => {
    if (rx.status === 'CANCELLED') return 'DISCONTINUED';
    if (new Date(rx.expiryDate) < new Date()) return 'EXPIRED';
    if (rx.items && rx.items.length > 0 && rx.items.every((i) => i.refillsRemaining === 0)) return 'COMPLETED';
    return 'ACTIVE';
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
              <Plus className="h-4 w-4 mr-1" /> New Prescription
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Prescription</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Patient Name *</Label>
                  <Input className="h-9" value={form.patientName} onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Patient Phone</Label>
                  <Input className="h-9" value={form.patientPhone} onChange={(e) => setForm((f) => ({ ...f, patientPhone: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Doctor Name *</Label>
                  <Input className="h-9" value={form.doctorName} onChange={(e) => setForm((f) => ({ ...f, doctorName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Doctor License # *</Label>
                  <Input className="h-9" value={form.doctorLicenseNumber} onChange={(e) => setForm((f) => ({ ...f, doctorLicenseNumber: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Expiry Date *</Label>
                <Input type="date" className="h-9" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input className="h-9" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Medications</Label>
                  <Button variant="outline" size="sm" onClick={addRxItem}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </div>
                <ScrollArea className="max-h-60">
                  <div className="space-y-3 pr-2">
                    {rxItems.map((item, idx) => (
                      <div key={idx} className="rounded-lg border p-3 space-y-2 relative">
                        {rxItems.length > 1 && (
                          <button
                            onClick={() => removeRxItem(idx)}
                            className="absolute top-2 right-2 text-muted-foreground hover:text-rose-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        <Select value={item.productId} onValueChange={(v) => updateRxItem(idx, 'productId', v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select medication" />
                          </SelectTrigger>
                          <SelectContent>
                            {products?.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.brandName} ({p.genericName})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-[10px]">Dosage</Label>
                            <Input className="h-8 text-xs" placeholder="1 tab twice daily" value={item.dosageInstructions} onChange={(e) => updateRxItem(idx, 'dosageInstructions', e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Qty/Refill</Label>
                            <Input type="number" className="h-8 text-xs" value={item.quantityPerRefill} onChange={(e) => updateRxItem(idx, 'quantityPerRefill', e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Refills</Label>
                            <Input type="number" className="h-8 text-xs" value={item.refillsAuthorized} onChange={(e) => updateRxItem(idx, 'refillsAuthorized', e.target.value)} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <Button className="w-full bg-brand-600 hover:bg-brand-700" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Prescription'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand-600" />
            Prescriptions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <SearchInput
              className="max-w-sm"
              placeholder="Search by Rx number, patient, or doctor..."
              value={rxSearch}
              onChange={setRxSearch}
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
          ) : filteredPrescriptions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rx Number</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrescriptions.map((rx) => (
                    <TableRow key={rx.rxNumber}>
                      <TableCell className="font-mono text-xs font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{rx.rxNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{rx.patientName}</p>
                          {rx.patientPhone && <p className="text-xs text-muted-foreground">{rx.patientPhone}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{rx.doctorName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-xs', statusColor(displayStatus(rx)))}>
                          {displayStatus(rx)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(rx.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(rx.expiryDate), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-brand-600 hover:text-brand-700"
                          onClick={() => {
                            setSelectedRx(rx);
                            setDetailOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                {rxSearch ? `No prescriptions match "${rxSearch}".` : 'No prescriptions found.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(open) => { setDetailOpen(open); if (!open) setIsEditingRx(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditingRx ? 'Edit Prescription' : 'Prescription Details'}</DialogTitle>
          </DialogHeader>
          {detailData && !isEditingRx && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Rx Number</p>
                  <p className="font-mono font-medium px-2 py-1 rounded bg-brand-50 text-brand-800 border border-brand-200 inline-block">{detailData.rxNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant="outline" className={cn('text-xs', statusColor(displayStatus(detailData)))}>
                    {displayStatus(detailData)}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Patient</p>
                  <p className="font-medium">{detailData.patientName}</p>
                  {detailData.patientPhone && <p className="text-xs text-muted-foreground">{detailData.patientPhone}</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Doctor</p>
                  <p className="font-medium">{detailData.doctorName}</p>
                  <p className="text-xs text-muted-foreground">Lic: {detailData.doctorLicenseNumber}</p>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-2">Medications</p>
                {detailData.items && detailData.items.length > 0 ? (
                  <div className="space-y-2">
                    {detailData.items.map((item) => (
                      <div key={item.id} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium">{item.product?.brandName}</p>
                          <span className="text-xs text-muted-foreground">{item.refillsAuthorized - item.refillsRemaining}/{item.refillsAuthorized} refills used</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.product?.genericName}</p>
                        <p className="text-xs mt-1">{item.dosageInstructions} &middot; Qty: {item.quantityPerRefill}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No medication details available.</p>
                )}
              </div>
              {detailData.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p className="text-sm">{detailData.notes}</p>
                  </div>
                </>
              )}
              {(canEdit || canDelete) && (
                <>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={startEditingRx}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                    )}
                    {canEdit && detailData.status === 'ACTIVE' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-amber-700 border-amber-300 hover:bg-amber-50"
                        disabled={cancelRxMutation.isPending}
                        onClick={() => cancelRxMutation.mutate()}
                      >
                        <Ban className="h-3.5 w-3.5 mr-1" /> {cancelRxMutation.isPending ? 'Cancelling...' : 'Cancel Prescription'}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-600 border-rose-300 hover:bg-rose-50"
                        onClick={() => setDeleteConfirmOpen(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                      </Button>
                    )}
                  </div>
                  {deleteConfirmOpen && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-2">
                      <p className="text-xs text-rose-800">
                        This permanently deletes the prescription. If any refill has ever been dispensed against it, this will be
                        rejected — cancel it instead in that case. This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                          {deleteMutation.isPending ? 'Deleting...' : 'Yes, Delete Permanently'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>Never mind</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {detailData && isEditingRx && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Patient Name *</Label>
                  <Input className="h-9" value={rxEditForm.patientName} onChange={(e) => setRxEditForm((f) => ({ ...f, patientName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Patient Phone</Label>
                  <Input className="h-9" value={rxEditForm.patientPhone} onChange={(e) => setRxEditForm((f) => ({ ...f, patientPhone: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Doctor Name *</Label>
                  <Input className="h-9" value={rxEditForm.doctorName} onChange={(e) => setRxEditForm((f) => ({ ...f, doctorName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Doctor License *</Label>
                  <Input className="h-9" value={rxEditForm.doctorLicenseNumber} onChange={(e) => setRxEditForm((f) => ({ ...f, doctorLicenseNumber: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Expiry Date *</Label>
                <Input type="date" className="h-9" value={rxEditForm.expiryDate} onChange={(e) => setRxEditForm((f) => ({ ...f, expiryDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={rxEditForm.notes} onChange={(e) => setRxEditForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>

              {detailData.items && detailData.items.length > 0 && (
                <>
                  <Separator />
                  <p className="text-sm font-medium">Medications</p>
                  {detailData.items.map((item) => {
                    const alreadyUsed = item.refillsAuthorized - item.refillsRemaining;
                    const f = itemEditForm[item.id] ?? { dosageInstructions: '', refillsAuthorized: '0', quantityPerRefill: '0', intervalDays: '30' };
                    return (
                      <div key={item.id} className="rounded-lg border p-3 space-y-2">
                        <p className="text-sm font-medium">{item.product?.brandName}</p>
                        <div>
                          <Label className="text-[10px]">Dosage Instructions</Label>
                          <Input className="h-8 text-xs" value={f.dosageInstructions} onChange={(e) => setItemEditForm((s) => ({ ...s, [item.id]: { ...f, dosageInstructions: e.target.value } }))} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-[10px]">Refills Authorized</Label>
                            <Input type="number" className="h-8 text-xs" min={alreadyUsed} value={f.refillsAuthorized} onChange={(e) => setItemEditForm((s) => ({ ...s, [item.id]: { ...f, refillsAuthorized: e.target.value } }))} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Qty / Refill</Label>
                            <Input type="number" className="h-8 text-xs" value={f.quantityPerRefill} onChange={(e) => setItemEditForm((s) => ({ ...s, [item.id]: { ...f, quantityPerRefill: e.target.value } }))} />
                          </div>
                          <div>
                            <Label className="text-[10px]">Interval (days)</Label>
                            <Input type="number" className="h-8 text-xs" value={f.intervalDays} onChange={(e) => setItemEditForm((s) => ({ ...s, [item.id]: { ...f, intervalDays: e.target.value } }))} />
                          </div>
                        </div>
                        {alreadyUsed > 0 && (
                          <p className="text-[10px] text-muted-foreground">{alreadyUsed} refill{alreadyUsed === 1 ? '' : 's'} already dispensed — refills authorized can&apos;t go below that.</p>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              <div className="flex gap-2">
                <Button className="flex-1 bg-brand-600 hover:bg-brand-700" disabled={updateMutation.isPending} onClick={handleSaveEdit}>
                  <Save className="h-3.5 w-3.5 mr-1" /> {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button variant="ghost" onClick={() => setIsEditingRx(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
