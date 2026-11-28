import { describe, it, expect } from 'vitest';
import {
  INVENTORY_PERMISSIONS,
  isInventoryPermissionKey,
  resolvePermission,
  roleDefault,
  settingOf,
} from '../src/lib/inventory-permissions';

// The rule that decides who may edit stock, change expiry dates and adjust
// stock. Pure logic — the API enforcement is covered in inventory-access.test.ts.

describe('role defaults', () => {
  it('editing batches and changing expiry dates are Admin-only until granted', () => {
    for (const key of ['inventory.edit', 'inventory.edit_expiry'] as const) {
      expect(roleDefault(key, 'ADMIN')).toBe(true);
      expect(roleDefault(key, 'MANAGER')).toBe(false);
      expect(roleDefault(key, 'EMPLOYEE')).toBe(false);
    }
  });
  it('stock adjustments stay open to Admin, Manager and Employee, exactly as before', () => {
    for (const role of ['ADMIN', 'MANAGER', 'EMPLOYEE']) expect(roleDefault('inventory.adjust', role)).toBe(true);
    expect(roleDefault('inventory.adjust', 'SOMETHING_ELSE')).toBe(false);
  });
});

describe('resolving one person\'s permission', () => {
  it('an Admin always has everything, whatever an override says', () => {
    for (const p of INVENTORY_PERMISSIONS) {
      expect(resolvePermission(p.key, 'ADMIN', undefined)).toBe(true);
      expect(resolvePermission(p.key, 'ADMIN', false)).toBe(true);
    }
  });
  it('with no override, the role default applies', () => {
    expect(resolvePermission('inventory.edit', 'MANAGER', undefined)).toBe(false);
    expect(resolvePermission('inventory.adjust', 'EMPLOYEE', undefined)).toBe(true);
  });
  it('an Admin can GRANT something the role would not allow', () => {
    expect(resolvePermission('inventory.edit_expiry', 'EMPLOYEE', true)).toBe(true);
    expect(resolvePermission('inventory.edit', 'MANAGER', true)).toBe(true);
  });
  it('an Admin can TAKE AWAY something the role would allow', () => {
    expect(resolvePermission('inventory.adjust', 'EMPLOYEE', false)).toBe(false);
    expect(resolvePermission('inventory.adjust', 'MANAGER', false)).toBe(false);
  });
  it('one grant does not leak into the others', () => {
    expect(resolvePermission('inventory.edit', 'EMPLOYEE', true)).toBe(true);
    expect(resolvePermission('inventory.edit_expiry', 'EMPLOYEE', undefined)).toBe(false);
  });
});

describe('helpers', () => {
  it('knows its own keys', () => {
    expect(isInventoryPermissionKey('inventory.edit')).toBe(true);
    expect(isInventoryPermissionKey('inventory.delete')).toBe(false);
    expect(isInventoryPermissionKey(undefined)).toBe(false);
  });
  it('shows an override as Allow / Deny / Default', () => {
    expect([settingOf(true), settingOf(false), settingOf(undefined)]).toEqual(['ALLOW', 'DENY', null]);
  });
});
