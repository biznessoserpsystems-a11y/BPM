'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  COMMON_UNITS,
  describePack,
  previewReceive,
  type DerivedUnit,
  type UnitFormState,
  type UnitSetup,
} from '@/lib/receive-units';

const NEW_UNIT = '__new__';

interface ReceiveUnitPickerProps {
  productSelected: boolean;
  setup: UnitSetup | undefined;
  loading: boolean;
  state: UnitFormState;
  derived: DerivedUnit;
  quantity: string;
  purchasePrice: string;
  onChange: (next: UnitFormState) => void;
}

/**
 * "Unit of measure" block for the Receive Goods form, shown under Quantity:
 * choose which unit the quantity is being entered in (the product's own
 * unit, or a packaging unit like "box"), or set up a new one on the spot —
 * "1 box = 10 pieces" — which is saved on the product for next time. Stock is
 * always stored in the product's base unit; the line at the bottom says
 * exactly what will go in.
 */
export function ReceiveUnitPicker({
  productSelected,
  setup,
  loading,
  state,
  derived,
  quantity,
  purchasePrice,
  onChange,
}: ReceiveUnitPickerProps) {
  const preview = previewReceive(derived, quantity, purchasePrice);
  const baseUnit = derived.baseUnit;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Unit of measure</Label>
        {productSelected && (
          <span className="text-[11px] text-muted-foreground">Stock is counted in {baseUnit}</span>
        )}
      </div>

      {!productSelected ? (
        <p className="text-xs text-muted-foreground">Choose a product first to set its unit.</p>
      ) : (
        <>
          <Select
            value={state.creating ? NEW_UNIT : derived.unitName}
            disabled={loading}
            onValueChange={(v) =>
              v === NEW_UNIT
                ? onChange({ ...state, creating: true })
                : onChange({ ...state, creating: false, selected: v })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={loading ? 'Loading…' : 'Select unit'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={setup?.baseUnit ?? baseUnit}>{setup?.baseUnit ?? baseUnit}</SelectItem>
              {setup?.packs.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name} — {describePack(p, setup.baseUnit)}
                </SelectItem>
              ))}
              <SelectItem value={NEW_UNIT}>+ Set up a new unit…</SelectItem>
            </SelectContent>
          </Select>

          {state.creating && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>1</span>
                <Input
                  className="h-8 w-24"
                  placeholder="box"
                  list="receive-unit-suggestions"
                  value={state.newName}
                  onChange={(e) => onChange({ ...state, newName: e.target.value })}
                  aria-label="New unit name"
                />
                <span>=</span>
                <Input
                  type="number"
                  min={2}
                  step={1}
                  className="h-8 w-20"
                  placeholder="10"
                  value={state.newUnitsPer}
                  onChange={(e) => onChange({ ...state, newUnitsPer: e.target.value })}
                  aria-label={`How many ${baseUnit} in one`}
                />
                {derived.baseEditable ? (
                  <Input
                    className="h-8 w-24"
                    placeholder="piece"
                    list="receive-unit-suggestions"
                    value={state.newBase}
                    onChange={(e) => onChange({ ...state, newBase: e.target.value })}
                    aria-label="What this product is counted in"
                  />
                ) : (
                  <span>{baseUnit}</span>
                )}
              </div>
              {derived.problem && <p className="text-xs text-rose-600">{derived.problem}</p>}
              <p className="text-[11px] text-muted-foreground">
                Saved on this product for next time. Admins and Managers can change it later in Settings → Units of
                Measure.
              </p>
              <datalist id="receive-unit-suggestions">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          )}

          {derived.isConverted && !derived.problem && (
            <div className="rounded bg-background border px-2 py-1.5 text-xs space-y-0.5">
              {preview.baseQuantity !== null ? (
                <p>
                  <span className="font-medium">
                    {Number(quantity)} {derived.unitName} × {derived.unitsPer} = {preview.baseQuantity} {baseUnit}
                  </span>{' '}
                  will be added to stock
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Enter a whole-number quantity in {derived.unitName} — each is {derived.unitsPer} {baseUnit}.
                </p>
              )}
              {preview.costPerBase !== null && (
                <p className="text-muted-foreground">
                  Cost per {baseUnit}: {preview.costPerBase.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
