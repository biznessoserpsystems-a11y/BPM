'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import { usePharmacyStore } from '@/lib/store';
import { fetchJson } from '@/lib/fetch-json';
import { COMMON_UNITS, DEFAULT_BASE_UNIT, describePack, type UnitSetup } from '@/lib/receive-units';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorBanner, errorMessage } from '@/components/ui/error-banner';

interface ProductRow {
  id: number;
  brandName: string;
  genericName: string;
  skuCode: string;
}

type ProductSetup = UnitSetup & { productId: number };

/**
 * Settings → Units of Measure: how each product is counted and packed.
 *
 * Stock is always counted in a product's BASE unit (piece, strip, bottle…).
 * Packaging units ("1 box = 10 pieces") are conversions into it, used when
 * receiving goods — the Receive Goods form lets anyone set one up on the
 * spot; this page lists every product's setup and is where an Admin or
 * Manager changes one.
 */
export function UnitsOfMeasureSection() {
  const { user } = usePharmacyStore();
  const canEdit = user?.roleName === 'ADMIN' || user?.roleName === 'MANAGER';
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ProductRow | null>(null);

  const { data: products = [], isLoading, isError, error } = useQuery<ProductRow[]>({
    queryKey: ['products-list'],
    queryFn: () => fetchJson<ProductRow[]>('/api/v1/products'),
  });
  const { data: setups = [] } = useQuery<ProductSetup[]>({
    queryKey: ['product-units-all'],
    queryFn: () => fetchJson<ProductSetup[]>('/api/v1/product-units'),
  });
  const setupByProduct = useMemo(() => new Map(setups.map((s) => [s.productId, s])), [setups]);

  const q = search.trim().toLowerCase();
  const rows = products.filter(
    (p) =>
      !q ||
      p.brandName.toLowerCase().includes(q) ||
      p.genericName.toLowerCase().includes(q) ||
      p.skuCode.toLowerCase().includes(q)
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Ruler className="h-4 w-4 text-slate-600" /> Units of Measure
          </CardTitle>
          <p className="text-sm text-muted-foreground pt-1">
            Stock is counted in each product&apos;s <span className="font-medium">base unit</span> (for example piece or
            strip). A packaging unit tells the system how many of those are in a larger pack — e.g.{' '}
            <span className="font-medium">1 box = 10 pieces</span> or{' '}
            <span className="font-medium">1 pack = 10 strips</span> — so you can receive goods in boxes and the stock
            is added in pieces automatically. Anyone receiving goods can set up a new unit on the Receive Goods form;{' '}
            {canEdit ? 'you can change them here.' : 'only an Admin or Manager can change them here.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search products…" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <ErrorBanner message={errorMessage(error)} />
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {products.length === 0 ? 'No products yet — add some in Catalog first.' : 'No products match your search.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Counted in</TableHead>
                  <TableHead>Packaging</TableHead>
                  {canEdit && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const setup = setupByProduct.get(p.id);
                  const base = setup?.baseUnit ?? DEFAULT_BASE_UNIT;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{p.brandName}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.genericName} · {p.skuCode}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{base}</TableCell>
                      <TableCell className="text-sm">
                        {setup && setup.packs.length > 0 ? (
                          <div className="space-y-0.5">
                            {setup.packs.map((pk) => (
                              <div key={pk.name}>{describePack(pk, base)}</div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">None set up</span>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(p)}>
                            <Pencil className="h-3 w-3 mr-1" /> Edit
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditUnitsDialog
          product={editing}
          setup={setupByProduct.get(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface PackDraft {
  name: string;
  unitsPer: string;
}

function EditUnitsDialog({
  product,
  setup,
  onClose,
}: {
  product: ProductRow;
  setup: ProductSetup | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [baseUnit, setBaseUnit] = useState(setup?.baseUnit ?? DEFAULT_BASE_UNIT);
  const [packs, setPacks] = useState<PackDraft[]>(
    (setup?.packs ?? []).map((p) => ({ name: p.name, unitsPer: String(p.unitsPer) }))
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      fetchJson(`/api/v1/products/${product.id}/units`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUnit,
          // Blank rows are just unfinished — drop them rather than erroring.
          packs: packs
            .filter((p) => p.name.trim() !== '' || p.unitsPer.trim() !== '')
            .map((p) => ({ name: p.name, unitsPer: Number(p.unitsPer) })),
        }),
      }),
    onSuccess: () => {
      toast.success('Units saved');
      queryClient.invalidateQueries({ queryKey: ['product-units-all'] });
      queryClient.invalidateQueries({ queryKey: ['product-units'] });
      onClose();
    },
    // The server's message is specific (e.g. "box is listed more than once").
    onError: (e: Error) => toast.error(e.message),
  });

  const baseLabel = baseUnit.trim() || DEFAULT_BASE_UNIT;
  const update = (i: number, patch: Partial<PackDraft>) =>
    setPacks((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Units — {product.brandName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Stock is counted in</Label>
            <Input
              className="h-9"
              list="units-settings-suggestions"
              placeholder="piece"
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              The smallest unit you sell or dispense — what the till and prescriptions count in.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Packaging</Label>
            {packs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                None yet. Add one to receive goods in boxes, packs, cartons and so on.
              </p>
            )}
            {packs.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>1</span>
                <Input
                  className="h-8 w-28"
                  list="units-settings-suggestions"
                  placeholder="box"
                  value={p.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  aria-label="Packaging unit name"
                />
                <span>=</span>
                <Input
                  type="number"
                  min={2}
                  step={1}
                  className="h-8 w-20"
                  placeholder="10"
                  value={p.unitsPer}
                  onChange={(e) => update(i, { unitsPer: e.target.value })}
                  aria-label={`How many ${baseLabel} in one`}
                />
                <span className="truncate">{baseLabel}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 ml-auto shrink-0"
                  onClick={() => setPacks((ps) => ps.filter((_, idx) => idx !== i))}
                  aria-label="Remove this packaging unit"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setPacks((ps) => [...ps, { name: '', unitsPer: '' }])}
              disabled={packs.length >= 10}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add packaging
            </Button>
          </div>

          <p className="rounded bg-muted/50 border px-2 py-1.5 text-[11px] text-muted-foreground">
            This only affects goods received from now on. Stock already on hand isn&apos;t changed.
          </p>

          <datalist id="units-settings-suggestions">
            {COMMON_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-brand-600 hover:bg-brand-700"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
