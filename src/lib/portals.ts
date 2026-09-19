/**
 * The canonical list of every "portal" (top-level module) in the system.
 * Keys must exactly match the `view` values used in sidebar-nav.tsx and
 * app-shell.tsx's view router — this file exists so the Access Control
 * UI (Settings → Access Control → Portal Access) always lists every real
 * portal without needing to be kept in sync by hand with the sidebar.
 */
export const PORTALS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pos', label: 'Point of Sale' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'prescriptions', label: 'Prescriptions' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'catalog', label: 'Catalog' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'reports', label: 'Reports' },
  { key: 'users', label: 'Users' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'settings', label: 'Settings' },
] as const;

export type PortalKey = (typeof PORTALS)[number]['key'];
export type ModuleAccessLevel = 'NONE' | 'VIEW' | 'EDIT';

export const ACCESS_LEVELS: { value: ModuleAccessLevel; label: string }[] = [
  { value: 'NONE', label: 'Not Allowed' },
  { value: 'VIEW', label: 'View Only' },
  { value: 'EDIT', label: 'View & Edit' },
];
