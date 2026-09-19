import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { PORTALS } from '@/lib/portals';

// Unlike /auth/users/[id]/module-access (Admin/Manager only, for
// managing anyone), this is unrestricted by role — every signed-in user
// needs to be able to ask "what can I see" for their own sidebar to
// render correctly, regardless of what role they hold.
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const overrides = await db.userModuleAccess.findMany({ where: { userId: auth.userId } });
    const overrideMap = new Map(overrides.map((o) => [o.moduleKey, o.accessLevel]));

    const modules = PORTALS.map((p) => ({
      moduleKey: p.key,
      accessLevel: overrideMap.get(p.key) ?? null,
    }));

    return NextResponse.json({ modules });
  } catch (error) {
    return handleApiError(error);
  }
}
