import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { db, createTestContext, type TestContext } from './fixtures';
import { makeRequest, jsonOf } from './request-helpers';
import { POST as login } from '../src/app/api/v1/auth/login/route';
import { POST as requestReactivationCode } from '../src/app/api/v1/auth/request-reactivation-code/route';
import { POST as reactivate } from '../src/app/api/v1/auth/reactivate/route';

describe('auth: login', () => {
  let ctx: TestContext;
  const rawPassword = 'CorrectHorseBattery9!';

  beforeAll(async () => {
    ctx = await createTestContext('login');
    // createTestContext's admin has an unknown-to-us generated password;
    // create a second user here with a password we control, to test
    // both the success and failure paths precisely.
    const role = await db.role.findUniqueOrThrow({ where: { roleName: 'PHARMACIST' } });
    await db.user.create({
      data: {
        companyId: ctx.companyId,
        username: `login-check-${ctx.suffix}`,
        passwordHash: await bcrypt.hash(rawPassword, 12),
        fullName: 'Login Check',
        roleId: role.id,
        homeBranchId: ctx.branchId,
      },
    });
  });

  it('succeeds with the correct password and returns a usable token', async () => {
    const res = await login(
      makeRequest('/api/v1/auth/login', {
        body: { username: `login-check-${ctx.suffix}`, password: rawPassword },
      })
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(`login-check-${ctx.suffix}`);
    // Never leak the hash or PIN back to the client.
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.pinCode).toBeUndefined();
  });

  it('rejects the wrong password with a generic message', async () => {
    const res = await login(
      makeRequest('/api/v1/auth/login', {
        body: { username: `login-check-${ctx.suffix}`, password: 'definitely-wrong' },
      })
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    // Generic on purpose — asserting the exact anti-enumeration wording
    // matters here, not just "it failed".
    expect(body.error.toLowerCase()).toContain('invalid');
  });

  it('rejects a username that does not exist with the same generic message', async () => {
    const res = await login(
      makeRequest('/api/v1/auth/login', {
        body: { username: 'no-such-user-at-all', password: 'whatever' },
      })
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error.toLowerCase()).toContain('invalid');
  });
});

describe('auth: reactivation requires the real password (regression test)', () => {
  // This guards the critical fix: POST /auth/reactivate must NEVER mint a
  // session from username + code alone. If this test ever goes green
  // without the password check, the account-takeover path is back.
  let ctx: TestContext;
  const rawPassword = 'ReactivateMe-4321!';
  let username: string;

  beforeAll(async () => {
    ctx = await createTestContext('reactivate');
    const role = await db.role.findUniqueOrThrow({ where: { roleName: 'ADMIN' } });
    username = `reactivate-user-${ctx.suffix}`;
    await db.user.create({
      data: {
        companyId: ctx.companyId,
        username,
        passwordHash: await bcrypt.hash(rawPassword, 12),
        fullName: 'Reactivate User',
        roleId: role.id,
        homeBranchId: ctx.branchId,
      },
    });
    // Simulate an expired trial so a reactivation code can legitimately be requested.
    await db.company.update({
      where: { id: ctx.companyId },
      data: { trialExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
  });

  it('hands out a code to an unauthenticated request (this part is intentional)', async () => {
    const res = await requestReactivationCode(
      makeRequest('/api/v1/auth/request-reactivation-code', { body: { username }, headers: { 'x-forwarded-for': `1.1.1.${ctx.suffix.length}-a` } })
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.code).toBeTruthy();
  });

  it('REFUSES to exchange a valid code for a session without the password', async () => {
    const ip = `1.1.1.${ctx.suffix.length}-b`;
    const codeRes = await requestReactivationCode(
      makeRequest('/api/v1/auth/request-reactivation-code', { body: { username }, headers: { 'x-forwarded-for': ip } })
    );
    const { code } = await jsonOf(codeRes);

    const res = await reactivate(makeRequest('/api/v1/auth/reactivate', { body: { username, code }, headers: { 'x-forwarded-for': ip } }));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.token).toBeUndefined();
  });

  it('REFUSES a valid code with the wrong password', async () => {
    const ip = `1.1.1.${ctx.suffix.length}-c`;
    const codeRes = await requestReactivationCode(
      makeRequest('/api/v1/auth/request-reactivation-code', { body: { username }, headers: { 'x-forwarded-for': ip } })
    );
    const { code } = await jsonOf(codeRes);

    const res = await reactivate(
      makeRequest('/api/v1/auth/reactivate', { body: { username, code, password: 'wrong-password' }, headers: { 'x-forwarded-for': ip } })
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.token).toBeUndefined();
  });

  it('succeeds with the correct code AND the correct password', async () => {
    const ip = `1.1.1.${ctx.suffix.length}-d`;
    const codeRes = await requestReactivationCode(
      makeRequest('/api/v1/auth/request-reactivation-code', { body: { username }, headers: { 'x-forwarded-for': ip } })
    );
    const { code } = await jsonOf(codeRes);

    const res = await reactivate(
      makeRequest('/api/v1/auth/reactivate', { body: { username, code, password: rawPassword }, headers: { 'x-forwarded-for': ip } })
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.token).toBeTruthy();

    const company = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    expect(company.trialExpiresAt).toBeNull();
  });
});
