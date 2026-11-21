import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { db, createTestContext, createTestUserWithRole, type TestContext, type TestUser } from './fixtures';
import { makeRequest, routeParams, jsonOf } from './request-helpers';
import { POST as resetPassword } from '../src/app/api/v1/auth/users/[id]/reset-password/route';
import { POST as login } from '../src/app/api/v1/auth/login/route';
import { GET as listUsers } from '../src/app/api/v1/auth/users/route';
import { GET as getUser, PATCH as patchUser } from '../src/app/api/v1/auth/users/[id]/route';
import { checkLoginLockout, recordFailedLogin } from '../src/lib/rate-limit';

const NEW_PASSWORD = 'Fresh-Passw0rd-1';

function reset(caller: TestUser, targetId: number, newPassword: string = NEW_PASSWORD) {
  return resetPassword(
    makeRequest(`/api/v1/auth/users/${targetId}/reset-password`, {
      token: caller.token,
      body: { newPassword },
    }),
    routeParams({ id: String(targetId) })
  );
}

async function hashOf(userId: number): Promise<string> {
  return (await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
}

describe('admin password reset', () => {
  let ctx: TestContext;
  let manager: TestUser;
  let otherManager: TestUser;
  let staff: TestUser;

  beforeAll(async () => {
    ctx = await createTestContext('pwreset');
    manager = await createTestUserWithRole(ctx, 'MANAGER', 'pwreset-mgr');
    otherManager = await createTestUserWithRole(ctx, 'MANAGER', 'pwreset-mgr2');
    staff = await createTestUserWithRole(ctx, 'PHARMACIST', 'pwreset-staff');
  });

  it('lets an Admin reset a staff password, and the new password then signs in', async () => {
    const res = await reset(ctx.admin, staff.id);
    expect(res.status).toBe(200);

    expect(await bcrypt.compare(NEW_PASSWORD, await hashOf(staff.id))).toBe(true);

    const signIn = await login(
      makeRequest('/api/v1/auth/login', { body: { username: staff.username, password: NEW_PASSWORD } })
    );
    expect(signIn.status).toBe(200);
  });

  it('records who reset whose password in the audit log, under the Admin\'s branch', async () => {
    const entry = await db.systemAuditLog.findFirst({
      where: { action: 'ADMIN_RESET_PASSWORD', entityId: String(staff.id) },
      orderBy: { id: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe(ctx.admin.id);
    expect(entry!.branchId).toBe(ctx.branchId);
  });

  it('clears a lockout from repeated wrong logins so the new password works straight away', async () => {
    for (let i = 0; i < 6; i++) recordFailedLogin(staff.username);
    expect(checkLoginLockout(staff.username)).not.toBeNull();

    const res = await reset(ctx.admin, staff.id, 'Another-Passw0rd-2');
    expect(res.status).toBe(200);
    expect(checkLoginLockout(staff.username)).toBeNull();
  });

  it('rejects a weak new password and leaves the old one in place', async () => {
    const before = await hashOf(staff.id);
    const res = await reset(ctx.admin, staff.id, 'short');
    expect(res.status).toBe(400);
    expect(await hashOf(staff.id)).toBe(before);
  });

  it('lets a Manager reset a regular staff member', async () => {
    const res = await reset(manager, staff.id, 'Manager-Set-Passw0rd-3');
    expect(res.status).toBe(200);
  });

  it('does NOT let a Manager reset an Admin — that would be a way to take over the Admin account', async () => {
    const before = await hashOf(ctx.admin.id);
    const res = await reset(manager, ctx.admin.id);
    expect(res.status).toBe(403);
    expect(await hashOf(ctx.admin.id)).toBe(before);
  });

  it('does NOT let a Manager reset another Manager', async () => {
    const before = await hashOf(otherManager.id);
    const res = await reset(manager, otherManager.id);
    expect(res.status).toBe(403);
    expect(await hashOf(otherManager.id)).toBe(before);
  });

  it('lets an Admin reset a Manager', async () => {
    const res = await reset(ctx.admin, otherManager.id);
    expect(res.status).toBe(200);
  });

  it('refuses to reset your own password here (that needs the current password, via Settings)', async () => {
    const before = await hashOf(ctx.admin.id);
    const res = await reset(ctx.admin, ctx.admin.id);
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: expect.stringContaining('Change Password') });
    expect(await hashOf(ctx.admin.id)).toBe(before);
  });

  it('treats a staff member as unable to reset anyone', async () => {
    const res = await reset(staff, otherManager.id);
    expect(res.status).toBe(403);
  });
});

describe('user routes are limited to the caller\'s own company', () => {
  let a: TestContext;
  let b: TestContext;
  let userInA: TestUser;

  beforeAll(async () => {
    a = await createTestContext('tenantA');
    b = await createTestContext('tenantB');
    userInA = await createTestUserWithRole(a, 'PHARMACIST', 'tenantA-staff');
  });

  it('an Admin of company B cannot reset a password in company A — and cannot even tell the user exists', async () => {
    const before = await hashOf(userInA.id);
    const res = await reset(b.admin, userInA.id);
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'User not found' });
    expect(await hashOf(userInA.id)).toBe(before);
  });

  it('an Admin of company B cannot take over company A\'s Admin', async () => {
    const before = await hashOf(a.admin.id);
    const res = await reset(b.admin, a.admin.id);
    expect(res.status).toBe(400);
    expect(await hashOf(a.admin.id)).toBe(before);
  });

  it('the staff directory only lists the caller\'s own company', async () => {
    const res = await listUsers(makeRequest('/api/v1/auth/users', { token: b.admin.token }));
    expect(res.status).toBe(200);
    const users = await jsonOf(res);
    const ids = users.map((u: { id: number }) => u.id);
    expect(ids).toContain(b.admin.id);
    expect(ids).not.toContain(a.admin.id);
    expect(ids).not.toContain(userInA.id);
  });

  it('another company\'s user cannot be viewed by id', async () => {
    const res = await getUser(
      makeRequest(`/api/v1/auth/users/${userInA.id}`, { token: b.admin.token }),
      routeParams({ id: String(userInA.id) })
    );
    expect(res.status).toBe(400);
  });

  it('another company\'s user cannot be deactivated', async () => {
    const res = await patchUser(
      makeRequest(`/api/v1/auth/users/${userInA.id}`, {
        method: 'PATCH',
        token: b.admin.token,
        body: { isActive: false },
      }),
      routeParams({ id: String(userInA.id) })
    );
    expect(res.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: userInA.id } })).isActive).toBe(true);
  });
});
