import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';

export interface InventoryPermissions {
  'inventory.edit': boolean;
  'inventory.edit_expiry': boolean;
  'inventory.adjust': boolean;
  'sales.edit_today': boolean;
  'sales.edit_past': boolean;
}

/**
 * What the signed-in person may do in Inventory, as worked out by the server
 * (role default + whatever an Admin granted or took away). Used only to decide
 * which buttons to show — the API checks again on every request, so a stale or
 * tampered value here can't actually do anything.
 *
 * Kept short-lived: when an Admin changes someone's access it should show up
 * quickly without them having to sign out.
 */
export function useInventoryPermissions() {
  const { data, isLoading } = useQuery<{ permissions: InventoryPermissions }>({
    queryKey: ['my-inventory-permissions'],
    queryFn: () => fetchJson<{ permissions: InventoryPermissions }>('/api/v1/auth/me/permissions'),
    staleTime: 15_000,
  });
  const p = data?.permissions;
  return {
    isLoading,
    canEditBatch: p?.['inventory.edit'] ?? false,
    canEditExpiry: p?.['inventory.edit_expiry'] ?? false,
    canAdjust: p?.['inventory.adjust'] ?? false,
    canEditSaleToday: p?.['sales.edit_today'] ?? false,
    canEditSalePast: p?.['sales.edit_past'] ?? false,
  };
}
