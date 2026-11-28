// Pure rules for editing a recorded sale (no database, no network), kept
// separate so they can be tested exactly.

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOBILE_MONEY', 'INSURANCE'] as const;

export interface LineInput {
  quantity: number;
  unitPrice: number;
}

export interface SaleTotals {
  subtotalAmount: number;
  totalAmount: number;
}

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function validateLine(input: { quantity: unknown; unitPrice: unknown }, returnedQuantity: number): LineInput {
  const { quantity, unitPrice } = input;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Quantity must be a whole number of at least 1. To take a product off the sale, process a return instead.');
  }
  if (quantity < returnedQuantity) {
    throw new Error(`${returnedQuantity} of this item has already been returned, so the quantity can't go below ${returnedQuantity}.`);
  }
  if (!isMoney(unitPrice)) throw new Error('Unit price must be zero or more.');
  return { quantity, unitPrice };
}

/** Same arithmetic as recording the sale: total = subtotal - discount + tax. */
export function computeTotals(lines: LineInput[], discountAmount: number, taxAmount: number): SaleTotals {
  if (!isMoney(discountAmount) || !isMoney(taxAmount)) throw new Error('Discount and tax cannot be negative.');
  const subtotalAmount = lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0);
  const totalAmount = subtotalAmount - discountAmount + taxAmount;
  if (totalAmount < 0) throw new Error(`The discount (${discountAmount}) cannot exceed the subtotal plus tax (${subtotalAmount + taxAmount}).`);
  return { subtotalAmount, totalAmount };
}

export const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export type EditDecision = { ok: true } | { ok: false; reason: string };

/**
 * Who may edit which sale:
 *  - a sale from TODAY needs "sales.edit_today"; and a person who isn't an
 *    Admin or Manager may only change their OWN sales;
 *  - a sale from an EARLIER day needs "sales.edit_past".
 * `has` answers whether the person holds a permission (role default + any
 * override an Admin set).
 */
export function decideEdit(args: {
  roleName: string;
  userId: number;
  sale: { userId: number; saleDate: Date };
  now: Date;
  has: (key: 'sales.edit_today' | 'sales.edit_past') => boolean;
}): EditDecision {
  const { roleName, userId, sale, now, has } = args;
  if (isSameLocalDay(sale.saleDate, now)) {
    if (!has('sales.edit_today')) return { ok: false, reason: 'You don’t have permission to edit today’s sales. Ask an administrator to grant it.' };
    if (roleName !== 'ADMIN' && roleName !== 'MANAGER' && sale.userId !== userId) {
      return { ok: false, reason: 'You can only edit sales you made yourself.' };
    }
    return { ok: true };
  }
  if (!has('sales.edit_past')) return { ok: false, reason: 'You don’t have permission to edit previous days’ sales. Ask an administrator to grant it.' };
  return { ok: true };
}
