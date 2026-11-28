import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { getAuthPayload, isAuthError } from '@/lib/auth';
import { effectivePermissions } from '@/lib/inventory-permissions';

// What the signed-in person may do in Inventory, worked out on the server
// (role default + any override an Admin set) so the screens only offer
// buttons that will actually work. Open to every signed-in user — it's only
// ever about themselves. The API enforces these independently; this is just
// so the UI doesn't show a button that would be refused.
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    return NextResponse.json({ permissions: await effectivePermissions(db, auth.userId, auth.roleName) });
  } catch (error) {
    return handleApiError(error);
  }
}
