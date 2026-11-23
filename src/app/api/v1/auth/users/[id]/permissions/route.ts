import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import {
  INVENTORY_PERMISSIONS,
  isInventoryPermissionKey,
  loadOverrides,
  resolvePermission,
  roleDefault,
  settingOf,
} from '@/lib/inventory-permissions';

// Granting or taking away someone's inventory capabilities is Admin-only —
// deliberately NOT Admin/Manager like Portal Access. These permissions are
// enforced, and they guard stock quantities and expiry dates; if a Manager
// could hand them out, a Manager could grant themselves (or an accomplice)
// the ability to quietly change expiry dates.
const CAN_GRANT = ['ADMIN'];

async function loadTarget(id: string, companyId: string) {
  const userId = Number(id);
  // Own company only — another company's user is just "not found".
  const user = Number.isInteger(userId)
    ? await db.user.findFirst({ where: { id: userId, companyId }, include: { role: true } })
    : null;
  if (!user) throw new PharmacyServiceError('User not found');
  return user;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_GRANT);
    if (roleError) return roleError;

    const user = await loadTarget((await params).id, auth.companyId);
    const overrides = await loadOverrides(db, user.id);
    const roleName = user.role.roleName;

    return NextResponse.json({
      userId: user.id,
      roleName,
      // Administrators always have every capability; nothing to configure.
      locked: roleName === 'ADMIN',
      permissions: INVENTORY_PERMISSIONS.map((p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        roleDefault: roleDefault(p.key, roleName),
        setting: settingOf(overrides.get(p.key)),
        effective: resolvePermission(p.key, roleName, overrides.get(p.key)),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Body: { permission: 'inventory.adjust', setting: 'ALLOW' | 'DENY' | 'DEFAULT' }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_GRANT);
    if (roleError) return roleError;

    const user = await loadTarget((await params).id, auth.companyId);
    const body = await request.json();
    const { permission, setting } = body ?? {};

    if (!isInventoryPermissionKey(permission)) {
      throw new PharmacyServiceError(`Unknown permission "${permission}"`);
    }
    if (!['ALLOW', 'DENY', 'DEFAULT'].includes(setting)) {
      throw new PharmacyServiceError('setting must be ALLOW, DENY, or DEFAULT');
    }
    if (user.role.roleName === 'ADMIN') {
      throw new PharmacyServiceError('Administrators always have every inventory permission — there is nothing to change.');
    }

    const before = settingOf((await loadOverrides(db, user.id)).get(permission));
    if (setting === 'DEFAULT') {
      await db.userPermission.deleteMany({ where: { userId: user.id, permission } });
    } else {
      await db.userPermission.upsert({
        where: { userId_permission: { userId: user.id, permission } },
        update: { allowed: setting === 'ALLOW', updatedByUserId: auth.userId },
        create: { userId: user.id, permission, allowed: setting === 'ALLOW', updatedByUserId: auth.userId },
      });
    }

    await writeAuditLog(db, {
      branchId: auth.homeBranchId,
      userId: auth.userId,
      action: 'UPDATE_USER_PERMISSION',
      entityName: 'User',
      entityId: String(user.id),
      details: { targetUsername: user.username, permission, from: before ?? 'DEFAULT', to: setting },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
