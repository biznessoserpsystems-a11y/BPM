'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Switch } from '@/components/ui/switch';
import { BookOpen, Plus, Pencil, Package, Building2, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fetchJson } from '@/lib/fetch-json';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';
import { usePharmacyStore } from '@/lib/store';
import { useModuleAccess } from '@/hooks/use-module-access';

interface Product {
  id: number;
  skuCode: string;
  barcode?: string;
  brandName: string;
  genericName: string;
  category: string;
  dosageForm: string;
  strength?: string;
  reorderLevel?: number;
  isControlledSubstance: boolean;
  isPrescriptionRequired: boolean;
  taxRate?: number;
}

interface Supplier {
  id: number;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  isActive: boolean;
  apAccountId?: number | null;
  apAccount?: { id: number; accountCode: string; accountName: string } | null;
}

interface AccountOption {
  id: number;
  accountCode: string;
  accountName: string;
  accountType: string;
}

const emptyProduct = {
  skuCode: '',
  barcode: '',
  brandName: '',
  genericName: '',
  category: '',
  dosageForm: '',
  strength: '',
  reorderLevel: '',
  isControlledSubstance: false,
  isPrescriptionRequired: false,
  taxRate: '',
};

const emptySupplier = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  apAccountId: '',
};

export function CatalogView() {
  const queryClient = useQueryClient();
  const [productOpen, setProductOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [pForm, setPForm] = useState(emptyProduct);
  const [sForm, setSForm] = useState(emptySupplier);

  const { data: products = [], isLoading: productsLoading, isError: productsError, error: productsErrorObj } = useQuery<Product[]>({
    queryKey: ['catalog-products'],
    queryFn: () => fetchJson<Product[]>('/api/v1/products'),
  });

  const { data: suppliers = [], isLoading: suppliersLoading, isError: suppliersError, error: suppliersErrorObj } = useQuery<Supplier[]>({
    queryKey: ['catalog-suppliers'],
    queryFn: () => fetchJson<Supplier[]>('/api/v1/suppliers'),
  });

  const filteredProducts = products.filter((p) => {
    const q = productSearch.toLowerCase();
    if (!q) return true;
    return (
      p.brandName.toLowerCase().includes(q) ||
      p.genericName.toLowerCase().includes(q) ||
      p.skuCode.toLowerCase().includes(q) ||
      (p.barcode?.toLowerCase().includes(q) ?? false) ||
      p.category.toLowerCase().includes(q)
    );
  });

  const filteredSuppliers = suppliers.filter((s) => {
    const q = supplierSearch.toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.contactPerson?.toLowerCase().includes(q) ?? false) ||
      s.phone.toLowerCase().includes(q) ||
      (s.email?.toLowerCase().includes(q) ?? false)
    );
  });

  const { user } = usePharmacyStore();
  const canLinkApAccount = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';
  const { canEdit } = useModuleAccess();
  const canEditCatalog = canEdit('catalog');

  const { data: liabilityAccounts = [] } = useQuery<AccountOption[]>({
    queryKey: ['liability-accounts-for-suppliers'],
    queryFn: async () => {
      const all = await fetchJson<AccountOption[]>('/api/v1/accounts');
      return all.filter((a) => a.accountType === 'LIABILITY');
    },
    enabled: canLinkApAccount,
  });

  const productMutation = useMutation({
    mutationFn: ({ id, body, method }: { id?: number; body: Record<string, unknown>; method: string }) =>
      fetchJson(id ? `/api/v1/products/${id}` : '/api/v1/products', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      toast.success(`Product ${vars.method === 'POST' ? 'created' : 'updated'}!`);
      setProductOpen(false);
      setEditingProduct(null);
      setPForm(emptyProduct);
      queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const supplierMutation = useMutation({
    mutationFn: ({ id, body, method }: { id?: number; body: Record<string, unknown>; method: string }) =>
      fetchJson(id ? `/api/v1/suppliers/${id}` : '/api/v1/suppliers', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      toast.success(`Supplier ${vars.method === 'POST' ? 'created' : 'updated'}!`);
      setSupplierOpen(false);
      setEditingSupplier(null);
      setSForm(emptySupplier);
      queryClient.invalidateQueries({ queryKey: ['catalog-suppliers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setPForm({
      skuCode: p.skuCode,
      barcode: p.barcode || '',
      brandName: p.brandName,
      genericName: p.genericName,
      category: p.category,
      dosageForm: p.dosageForm,
      strength: p.strength || '',
      reorderLevel: String(p.reorderLevel || ''),
      isControlledSubstance: p.isControlledSubstance,
      isPrescriptionRequired: p.isPrescriptionRequired,
      taxRate: String(p.taxRate || ''),
    });
    setProductOpen(true);
  };

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSForm({
      name: s.name,
      contactPerson: s.contactPerson || '',
      phone: s.phone,
      email: s.email || '',
      address: s.address || '',
      apAccountId: s.apAccountId ? String(s.apAccountId) : '',
    });
    setSupplierOpen(true);
  };

  const handleSaveProduct = () => {
    if (!pForm.skuCode || !pForm.brandName || !pForm.genericName || !pForm.category || !pForm.dosageForm) {
      toast.error('Please fill in all required fields');
      return;
    }
    const body: Record<string, unknown> = {
      skuCode: pForm.skuCode,
      brandName: pForm.brandName,
      genericName: pForm.genericName,
      category: pForm.category,
      dosageForm: pForm.dosageForm,
      strength: pForm.strength || undefined,
      reorderLevel: pForm.reorderLevel ? Number(pForm.reorderLevel) : undefined,
      isControlledSubstance: pForm.isControlledSubstance,
      isPrescriptionRequired: pForm.isPrescriptionRequired,
      taxRate: pForm.taxRate ? Number(pForm.taxRate) : undefined,
    };
    if (editingProduct) {
      productMutation.mutate({ id: editingProduct.id, body, method: 'PATCH' });
    } else {
      productMutation.mutate({ body: { ...body, barcode: pForm.barcode || undefined }, method: 'POST' });
    }
  };

  const handleSaveSupplier = () => {
    if (!sForm.name || !sForm.phone) {
      toast.error('Name and phone are required');
      return;
    }
    const body: Record<string, unknown> = {
      name: sForm.name,
      phone: sForm.phone,
      contactPerson: sForm.contactPerson || undefined,
      email: sForm.email || undefined,
      address: sForm.address || undefined,
      apAccountId: sForm.apAccountId ? Number(sForm.apAccountId) : null,
    };
    if (editingSupplier) {
      supplierMutation.mutate({ id: editingSupplier.id, body, method: 'PATCH' });
    } else {
      supplierMutation.mutate({ body, method: 'POST' });
    }
  };

  return (
    <Tabs defaultValue="products" className="space-y-4">
      <TileTabsList>
        <TileTabsTrigger value="products" icon={Package} label="Products" color="brand" />
        <TileTabsTrigger value="suppliers" icon={Building2} label="Suppliers" color="orange" />
      </TileTabsList>

      {/* Products Tab */}
      <TabsContent value="products">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-brand-600" /> Products
            </CardTitle>
            {canEditCatalog && (
            <Dialog open={productOpen} onOpenChange={(open) => { setProductOpen(open); if (!open) { setEditingProduct(null); setPForm(emptyProduct); } }}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
                  <Plus className="h-4 w-4 mr-1" /> Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingProduct ? 'Edit' : 'Add'} Product</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">SKU Code *</Label>
                      <Input className="h-9" value={pForm.skuCode} onChange={(e) => setPForm((f) => ({ ...f, skuCode: e.target.value }))} disabled={!!editingProduct} />
                    </div>
                    <div>
                      <Label className="text-xs">Barcode</Label>
                      <Input className="h-9" value={pForm.barcode} onChange={(e) => setPForm((f) => ({ ...f, barcode: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Brand Name *</Label>
                      <Input className="h-9" value={pForm.brandName} onChange={(e) => setPForm((f) => ({ ...f, brandName: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Generic Name *</Label>
                      <Input className="h-9" value={pForm.genericName} onChange={(e) => setPForm((f) => ({ ...f, genericName: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Category *</Label>
                      <Input className="h-9" placeholder="Antibiotic" value={pForm.category} onChange={(e) => setPForm((f) => ({ ...f, category: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Dosage Form *</Label>
                      <Input className="h-9" placeholder="Tablet" value={pForm.dosageForm} onChange={(e) => setPForm((f) => ({ ...f, dosageForm: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Strength</Label>
                      <Input className="h-9" placeholder="500mg" value={pForm.strength} onChange={(e) => setPForm((f) => ({ ...f, strength: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Reorder Level</Label>
                      <Input type="number" className="h-9" value={pForm.reorderLevel} onChange={(e) => setPForm((f) => ({ ...f, reorderLevel: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Tax Rate (%)</Label>
                      <Input type="number" className="h-9" value={pForm.taxRate} onChange={(e) => setPForm((f) => ({ ...f, taxRate: e.target.value }))} />
                    </div>
                    <div className="flex items-end gap-4 pb-1">
                      <div className="flex items-center gap-2">
                        <Switch checked={pForm.isPrescriptionRequired} onCheckedChange={(c) => setPForm((f) => ({ ...f, isPrescriptionRequired: c }))} />
                        <Label className="text-xs">Rx Required</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={pForm.isControlledSubstance} onCheckedChange={(c) => setPForm((f) => ({ ...f, isControlledSubstance: c }))} />
                        <Label className="text-xs">Controlled</Label>
                      </div>
                    </div>
                  </div>
                  <Button className="w-full bg-brand-600 hover:bg-brand-700" onClick={handleSaveProduct} disabled={productMutation.isPending}>
                    {productMutation.isPending ? 'Saving...' : 'Save Product'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="p-4 border-b">
              <SearchInput
                className="max-w-sm"
                placeholder="Search by brand, generic name, SKU, or category..."
                value={productSearch}
                onChange={setProductSearch}
              />
            </div>
            {productsError ? (
              <ErrorBanner message={errorMessage(productsErrorObj)} />
            ) : productsLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : filteredProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Generic</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Form</TableHead>
                      <TableHead>Strength</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">{p.skuCode}</TableCell>
                        <TableCell className="text-sm font-medium">{p.brandName}</TableCell>
                        <TableCell className="text-sm">{p.genericName}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{p.category}</Badge></TableCell>
                        <TableCell className="text-sm">{p.dosageForm}</TableCell>
                        <TableCell className="text-sm">{p.strength || '-'}</TableCell>
                        <TableCell className="flex gap-1 flex-wrap">
                          {p.isPrescriptionRequired && <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">Rx</Badge>}
                          {p.isControlledSubstance && <Badge variant="outline" className="text-rose-600 border-rose-300 text-[10px]">Ctrl</Badge>}
                        </TableCell>
                        <TableCell>
                          {canEditCatalog && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditProduct(p)}>
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Package className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {productSearch ? `No products match "${productSearch}".` : 'No products found.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Suppliers Tab */}
      <TabsContent value="suppliers">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand-600" /> Suppliers
            </CardTitle>
            {canEditCatalog && (
            <Dialog open={supplierOpen} onOpenChange={(open) => { setSupplierOpen(open); if (!open) { setEditingSupplier(null); setSForm(emptySupplier); } }}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-brand-600 hover:bg-brand-700">
                  <Plus className="h-4 w-4 mr-1" /> Add Supplier
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingSupplier ? 'Edit' : 'Add'} Supplier</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Company Name *</Label>
                    <Input className="h-9" value={sForm.name} onChange={(e) => setSForm((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Contact Person</Label>
                    <Input className="h-9" value={sForm.contactPerson} onChange={(e) => setSForm((f) => ({ ...f, contactPerson: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Phone *</Label>
                      <Input className="h-9" value={sForm.phone} onChange={(e) => setSForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input type="email" className="h-9" value={sForm.email} onChange={(e) => setSForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Address</Label>
                    <Input className="h-9" value={sForm.address} onChange={(e) => setSForm((f) => ({ ...f, address: e.target.value }))} />
                  </div>
                  {canLinkApAccount && (
                    <div>
                      <Label className="text-xs">Accounts Payable Account</Label>
                      <Select value={sForm.apAccountId} onValueChange={(v) => setSForm((f) => ({ ...f, apAccountId: v === 'NONE' ? '' : v }))}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Use default AP account" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">Use default AP account</SelectItem>
                          {liabilityAccounts.map((a) => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.accountCode} — {a.accountName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Links this supplier&apos;s goods receipts to their own payable sub-account instead of the shared global AP account.
                      </p>
                    </div>
                  )}
                  <Button className="w-full bg-brand-600 hover:bg-brand-700" onClick={handleSaveSupplier} disabled={supplierMutation.isPending}>
                    {supplierMutation.isPending ? 'Saving...' : 'Save Supplier'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="p-4 border-b">
              <SearchInput
                className="max-w-sm"
                placeholder="Search by company, contact, phone, or email..."
                value={supplierSearch}
                onChange={setSupplierSearch}
              />
            </div>
            {suppliersError ? (
              <ErrorBanner message={errorMessage(suppliersErrorObj)} />
            ) : suppliersLoading ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : filteredSuppliers.length > 0 ? (
              <div className="overflow-x-auto">
                {(() => {
                  const unlinkedCount = suppliers.filter((s) => s.isActive && !s.apAccountId).length;
                  return unlinkedCount > 0 ? (
                    <div className="m-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                      <LinkIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <strong>{unlinkedCount} active supplier{unlinkedCount > 1 ? 's are' : ' is'} not linked</strong> to their own Accounts Payable account —
                        their goods receipts post to the shared global AP account instead. Edit a supplier to link one.
                      </div>
                    </div>
                  ) : null;
                })()}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>AP Account</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSuppliers.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm font-medium">{s.name}</TableCell>
                        <TableCell className="text-sm">{s.contactPerson || '-'}</TableCell>
                        <TableCell className="text-sm">{s.phone}</TableCell>
                        <TableCell className="text-sm">{s.email || '-'}</TableCell>
                        <TableCell className="text-sm max-w-32 truncate">{s.address || '-'}</TableCell>
                        <TableCell>
                          {s.apAccount ? (
                            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200">
                              {s.apAccount.accountCode}
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">Default AP</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.isActive ? 'default' : 'secondary'} className={cn('text-xs', s.isActive && 'bg-brand-100 text-brand-700')}>
                            {s.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {canEditCatalog && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditSupplier(s)}>
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Building2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {supplierSearch ? `No suppliers match "${supplierSearch}".` : 'No suppliers found.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
