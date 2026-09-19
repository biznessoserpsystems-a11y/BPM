import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api-error';
import { PharmacyServiceError } from '@/lib/errors';
import { getAuthPayload, isAuthError, requireRole } from '@/lib/auth';
import { canAccessBranch } from '@/lib/branch-access';
import { validatePasswordStrength } from '@/lib/password-policy';
import type { CreateUserInput } from '@/types/pharmacy';

// The staff directory (role, email, license number, home branch for every
// user) is sensitive beyond ordinary operational data. Pharmacist/Tech may
// only list their own branch's staff (still useful — e.g. for the
// dropdown for "dispensed by"); an *unfiltered* system-wide directory dump
// is Admin/Manager only.
const CAN_VIEW_ALL_BRANCHES_DIRECTORY = ['ADMIN', 'MANAGER'];

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;

    const branchId = request.nextUrl.searchParams.get('branchId');
    if (branchId && !(await canAccessBranch(db, auth, branchId))) {
      throw new PharmacyServiceError("You do not have access to this branch's data");
    }
    if (!branchId) {
      const roleError = requireRole(auth, CAN_VIEW_ALL_BRANCHES_DIRECTORY);
      if (roleError) return roleError;
    }

    const where = branchId ? { homeBranchId: branchId } : {};

    const users = await db.user.findMany({
      where,
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    // Return users without passwordHash and pinCode
    const safeUsers = users.map(({ passwordHash, pinCode, ...user }) => ({
      ...user,
      permissions: user.role.permissions.map((rp) => rp.permission.permissionName),
    }));

    return NextResponse.json(safeUsers);
  } catch (error) {
    return handleApiError(error);
  }
}

// Only Admin provisions new accounts — creating a user (and, separately,
// setting their role — see PATCH /api/v1/auth/users/[id]) is held to a
// tighter tier than the rest of user management, which Manager can still
// do (deactivating an account, resetting a forgotten password).
const CAN_CREATE_USER = ['ADMIN'];

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthPayload(request);
    if (isAuthError(auth)) return auth;
    const roleError = requireRole(auth, CAN_CREATE_USER);
    if (roleError) return roleError;

    const body: CreateUserInput = await request.json();

    if (!body.username || !body.password || !body.fullName || !body.roleId) {
      throw new PharmacyServiceError('username, password, fullName, and roleId are required');
    }

    const strength = validatePasswordStrength(body.password);
    if (!strength.valid) {
      throw new PharmacyServiceError(strength.message!);
    }

    const existing = await db.user.findUnique({ where: { username: body.username } });
    if (existing) {
      throw new PharmacyServiceError(`Username "${body.username}" is already taken`);
    }

    const role = await db.role.findUnique({ where: { id: body.roleId } });
    if (!role) {
      throw new PharmacyServiceError(`Role ${body.roleId} not found`);
    }

    const homeBranchId = body.homeBranchId || auth.homeBranchId;
    const homeBranch = await db.branch.findUnique({ where: { id: homeBranchId } });
    if (!homeBranch || homeBranch.companyId !== auth.companyId) {
      throw new PharmacyServiceError(`Branch "${homeBranchId}" not found in your company`);
    }

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await db.user.create({
      data: {
        username: body.username,
        passwordHash,
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        roleId: body.roleId,
        homeBranchId,
        licenseNumber: body.licenseNumber,
        companyId: auth.companyId,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        homeBranchId: true,
        licenseNumber: true,
        isActive: true,
        role: { select: { id: true, roleName: true } },
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
