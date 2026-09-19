import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit-log';
import { PORTALS } from '@/lib/portals';

// Deliberately Admin/Manager only, per how this feature was scoped —
// assigning what portals and edit rights a colleague has is an
// access-control decision, held to the same tier as Access Control
// itself (role-permission grants) elsewhere in Settings.
const CAN_MANAGE_MODULE_ACCESS = ['ADMIN', 'MANAGER'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_MODULE_ACCESS);
    if (roleError) return roleError;

    const { id } = await params;
    const userId = Number(id);

    const targetUser = await db.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      throw new PharmacyServiceError('User not found');
    }

    const overrides = await db.userModuleAccess.findMany({ where: { userId } });
    const overrideMap = new Map(overrides.map((o) => [o.moduleKey, o.accessLevel]));

    // Always return every known portal, even ones with no override yet —
    // accessLevel is null for those, meaning "inherited/default" rather
    // than an explicit grant or restriction.
    const modules = PORTALS.map((p) => ({
      moduleKey: p.key,
      label: p.label,
      accessLevel: overrideMap.get(p.key) ?? null,
    }));

    return NextResponse.json({ userId, modules });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_MODULE_ACCESS);
    if (roleError) return roleError;

    const { id } = await params;
    const userId = Number(id);
    const body = await request.json();
    const { moduleKey, accessLevel } = body;

    if (!PORTALS.some((p) => p.key === moduleKey)) {
      throw new PharmacyServiceError(`Unknown portal "${moduleKey}"`);
    }

    const targetUser = await db.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      throw new PharmacyServiceError('User not found');
    }

    // 'DEFAULT' clears the override entirely, reverting this user's
    // access for this one portal back to whatever their Role alone
    // permits — the same as if it had never been set.
    if (accessLevel === 'DEFAULT') {
      await db.userModuleAccess.deleteMany({ where: { userId, moduleKey } });
    } else {
      if (!['NONE', 'VIEW', 'EDIT'].includes(accessLevel)) {
        throw new PharmacyServiceError('accessLevel must be NONE, VIEW, EDIT, or DEFAULT');
      }
      await db.userModuleAccess.upsert({
        where: { userId_moduleKey: { userId, moduleKey } },
        update: { accessLevel },
        create: { userId, moduleKey, accessLevel },
      });
    }

    await writeAuditLog(db, {
      userId: auth.userId,
      action: 'UPDATE_MODULE_ACCESS',
      entityName: 'User',
      entityId: String(userId),
      details: { targetUsername: targetUser.username, moduleKey, accessLevel },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
