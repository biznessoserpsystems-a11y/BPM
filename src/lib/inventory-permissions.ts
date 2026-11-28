import { NextResponse } from 'next/server';
import type { db } from '@/lib/db';
import type { AuthPayload } from '@/lib/auth';

// Who may edit received stock, change expiry dates, and make stock
// adjustments — and how an Admin can grant (or take away) each one for a
// specific person.
//
// Two layers, decided in this order:
//   1. ADMINISTRATORS always have every capability. They can't be locked out
//      or restricted, so there is always someone who can fix a mistake.
//   2. Everyone else: a per-user override set by an Admin (UserPermission)
//      wins if there is one — allowed OR not allowed; otherwise the role's
//      default below applies.
//
// Unlike Portal Access (which only hides buttons), these are checked by the
// API itself, so a missing permission can't be bypassed by calling it directly.

export const INVENTORY_PERMISSIONS = [
  {
    key: 'inventory.edit',
    label: 'Edit batch details',
    description: 'Change a received batch\u2019s batch number, supplier and prices.',
    // New capability: Admin only, until an Admin grants it to someone.
    defaultRoles: ['ADMIN'],
  },
  {
    key: 'inventory.edit_expiry',
    label: 'Change expiry dates',
    description:
      'Change when a batch expires. This affects first-expired-first-out picking and expiry alerts, so a reason is required and recorded.',
    defaultRoles: ['ADMIN'],
  },
  {
    key: 'inventory.adjust',
    label: 'Make stock adjustments',
    description:
      'Add or remove stock (damage, expiry, recount…). Removals are posted to the books as a write-down.',
    // Unchanged from how adjustments were already gated, so nobody who could
    // adjust stock before suddenly can't.
    defaultRoles: ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  },
  {
    key: 'sales.edit_today',
    label: 'Edit today\u2019s sales',
    description:
      'Correct a sale made today: customer details, payment method, quantities, prices, discount and tax. Stock and the books are corrected to match. Cashiers can only change their own sales; a reason is required and recorded.',
    defaultRoles: ['ADMIN', 'MANAGER', 'EMPLOYEE'],
  },
  {
    key: 'sales.edit_past',
    label: 'Edit previous days\u2019 sales',
    description:
      'The same corrections on a sale from an earlier day, for any cashier. Needs an open accounting period. Admin only until an Admin grants it.',
    defaultRoles: ['ADMIN'],
  },
] as const;

export type InventoryPermissionKey = (typeof INVENTORY_PERMISSIONS)[number]['key'];
export type PermissionSetting = 'ALLOW' | 'DENY' | null;

type Client = typeof db | Parameters<Parameters<typeof db.$transaction>[0]>[0];

export function isInventoryPermissionKey(value: unknown): value is InventoryPermissionKey {
  return INVENTORY_PERMISSIONS.some((p) => p.key === value);
}

export function permissionInfo(key: InventoryPermissionKey) {
  return INVENTORY_PERMISSIONS.find((p) => p.key === key)!;
}

/** What the role alone allows, ignoring any per-user override. */
export function roleDefault(key: InventoryPermissionKey, roleName: string): boolean {
  return (permissionInfo(key).defaultRoles as readonly string[]).includes(roleName);
}

/**
 * The single rule. `override` is the person's UserPermission.allowed, or
 * undefined when none is set.
 */
export function resolvePermission(
  key: InventoryPermissionKey,
  roleName: string,
  override: boolean | undefined
): boolean {
  if (roleName === 'ADMIN') return true;
  if (override !== undefined) return override;
  return roleDefault(key, roleName);
}

export function settingOf(override: boolean | undefined): PermissionSetting {
  return override === undefined ? null : override ? 'ALLOW' : 'DENY';
}

export async function loadOverrides(client: Client, userId: number): Promise<Map<string, boolean>> {
  const rows = await client.userPermission.findMany({ where: { userId } });
  return new Map(rows.map((r) => [r.permission, r.allowed]));
}

/** Read from the database on every call, so a grant or revoke applies immediately — no re-login. */
export async function effectivePermissions(
  client: Client,
  userId: number,
  roleName: string
): Promise<Record<InventoryPermissionKey, boolean>> {
  const overrides = await loadOverrides(client, userId);
  const out = {} as Record<InventoryPermissionKey, boolean>;
  for (const p of INVENTORY_PERMISSIONS) out[p.key] = resolvePermission(p.key, roleName, overrides.get(p.key));
  return out;
}

export async function hasInventoryPermission(
  client: Client,
  auth: Pick<AuthPayload, 'userId' | 'roleName'>,
  key: InventoryPermissionKey
): Promise<boolean> {
  if (auth.roleName === 'ADMIN') return true;
  const row = await client.userPermission.findUnique({
    where: { userId_permission: { userId: auth.userId, permission: key } },
  });
  return resolvePermission(key, auth.roleName, row?.allowed);
}

/** Same shape as requireRole: null when allowed, a ready-to-return 403 when not. */
export async function requireInventoryPermission(
  client: Client,
  auth: Pick<AuthPayload, 'userId' | 'roleName'>,
  key: InventoryPermissionKey
): Promise<NextResponse | null> {
  if (await hasInventoryPermission(client, auth, key)) return null;
  const { label } = permissionInfo(key);
  return NextResponse.json(
    { error: `You don\u2019t have permission to ${label.charAt(0).toLowerCase()}${label.slice(1)}. Ask an administrator to grant it.` },
    { status: 403 }
  );
}
