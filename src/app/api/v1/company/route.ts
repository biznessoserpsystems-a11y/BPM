import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { isSafeImageDataUri } from '@/lib/logo-validation';

// A data URI, not a hosted file — see the comment on Company.logoUrl.
// Capped well above what any reasonable logo needs (a few hundred KB at
// most) so nobody accidentally stores a multi-megabyte image that then
// gets embedded on every single page load for their whole company.
const MAX_LOGO_LENGTH = 500_000;

// Only Admin can change company-wide branding — same tier as the Chart
// of Accounts or Approval Workflow, both similarly "everyone is affected
// by this one setting."
const CAN_MANAGE_COMPANY = ['ADMIN'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const company = await db.company.findUnique({ where: { id: auth.companyId } });
    if (!company) {
      throw new PharmacyServiceError('Company not found');
    }

    return NextResponse.json(company);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_MANAGE_COMPANY);
    if (roleError) return roleError;

    const body = await request.json();
    const name: string | undefined = body.name?.trim();
    // Explicit null (not just undefined) is how the frontend asks to
    // remove a logo entirely — Prisma's update happily accepts null for
    // an optional field, but only if we actually pass it through instead
    // of defaulting a nullish value away.
    const logoUrl: string | null | undefined = body.logoUrl === null ? null : body.logoUrl?.trim() || undefined;
    // Same explicit-null pattern for removing a trial restriction —
    // new companies no longer get one at all (see POST
    // /auth/register-company), so this only ever matters for a company
    // that still has one set from before that change.
    const clearTrial: boolean = body.trialExpiresAt === null;

    if (logoUrl && logoUrl.length > MAX_LOGO_LENGTH) {
      throw new PharmacyServiceError('Logo image is too large — please use a smaller image (a few hundred KB or less)');
    }
    if (logoUrl && !isSafeImageDataUri(logoUrl)) {
      throw new PharmacyServiceError('Logo must be a PNG, JPEG, GIF, or WebP image');
    }

    const updated = await db.company.update({
      where: { id: auth.companyId },
      data: { name, logoUrl, ...(clearTrial ? { trialExpiresAt: null } : {}) },
    });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
