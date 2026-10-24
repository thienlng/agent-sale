import { MfaSetup, MfaStatus, RecoveryCodes } from '@agent-sales/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stepAt, totpAt } from '../src/modules/identity/domain/totp.js';
import { type Harness, startHarness } from './support/harness.js';

/** Two-factor on a real Postgres (ADM-04): setup, gated login, replay, recovery, disable. */
let t: Harness;
beforeAll(async () => {
  t = await startHarness();
});
afterAll(async () => {
  await t?.stop();
});

const login = (email: string, password: string, code?: string, ip = '10.9.0.1') =>
  t.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ip,
      payload: { email, password, ...(code ? { code } : {}) },
    });

describe('two-factor', () => {
  it('full lifecycle', async () => {
    const lan = await t.user('lan@mfa.vn', 'Lan MFA');

    expect(MfaStatus.parse((await t.call(lan.auth, 'GET', '/auth/mfa')).json())).toEqual({
      enabled: false,
      recoveryCodesLeft: 0,
    });

    // Setup needs the password.
    const bad = await t.call(lan.auth, 'POST', '/auth/mfa/setup', { password: 'nope nope nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.reason).toBe('invalid_password');

    const setup = MfaSetup.parse(
      (await t.call(lan.auth, 'POST', '/auth/mfa/setup', { password: lan.password })).json(),
    );
    expect(setup.otpauthUri).toContain(setup.secret);

    // Pending setup does not gate login; a wrong first code does not enable.
    expect((await login(lan.email, lan.password)).statusCode).toBe(200);
    const wrong = await t.call(lan.auth, 'POST', '/auth/mfa/enable', { code: '000000' });
    expect(wrong.statusCode).toBe(400);

    const step = stepAt(Date.now());
    const enabled = await t.call(lan.auth, 'POST', '/auth/mfa/enable', {
      code: totpAt(setup.secret, step),
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const { recoveryCodes } = RecoveryCodes.parse(enabled.json());
    expect(recoveryCodes).toHaveLength(8);

    // Login now needs a code; the secret never comes back.
    const noCode = await login(lan.email, lan.password);
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().error.details.reason).toBe('mfa_required');
    const badCode = await login(lan.email, lan.password, '123456');
    expect(badCode.json().error.details.reason).toBe('mfa_invalid');

    // The enabling code is burned; the next step's code works once.
    const next = totpAt(setup.secret, step + 1);
    expect((await login(lan.email, lan.password, next)).statusCode).toBe(200);
    expect((await login(lan.email, lan.password, next)).statusCode).toBe(401);

    // Recovery code: once.
    const [r1, r2] = recoveryCodes as [string, string];
    expect((await login(lan.email, lan.password, r1)).statusCode).toBe(200);
    expect((await login(lan.email, lan.password, r1)).statusCode).toBe(401);
    expect(MfaStatus.parse((await t.call(lan.auth, 'GET', '/auth/mfa')).json())).toEqual({
      enabled: true,
      recoveryCodesLeft: 7,
    });

    // New recovery codes invalidate the old ones.
    const regen = await t.call(lan.auth, 'POST', '/auth/mfa/recovery-codes', {
      password: lan.password,
      code: r2,
    });
    expect(regen.statusCode, regen.body).toBe(200);
    const fresh = RecoveryCodes.parse(regen.json()).recoveryCodes;
    expect((await login(lan.email, lan.password, recoveryCodes[2] as string)).statusCode).toBe(401);
    expect((await login(lan.email, lan.password, fresh[0] as string)).statusCode).toBe(200);

    // Setup again while enabled is refused; disabling needs password + code.
    const again = await t.call(lan.auth, 'POST', '/auth/mfa/setup', { password: lan.password });
    expect(again.statusCode).toBe(409);
    const noPw = await t.call(lan.auth, 'POST', '/auth/mfa/disable', {
      password: 'wrong wrong wrong',
      code: fresh[1],
    });
    expect(noPw.statusCode).toBe(400);
    const off = await t.call(lan.auth, 'POST', '/auth/mfa/disable', {
      password: lan.password,
      code: fresh[1],
    });
    expect(off.statusCode, off.body).toBe(204);
    expect((await login(lan.email, lan.password)).statusCode).toBe(200);
  });

  it('login attempts are rate limited per address and email', async () => {
    const binh = await t.user('binh@mfa.vn', 'Binh MFA');
    const setup = MfaSetup.parse(
      (await t.call(binh.auth, 'POST', '/auth/mfa/setup', { password: binh.password })).json(),
    );
    await t.call(binh.auth, 'POST', '/auth/mfa/enable', {
      code: totpAt(setup.secret, stepAt(Date.now())),
    });
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await login(binh.email, binh.password, '111111', '10.9.0.2')).statusCode;
    }
    expect(last).toBe(429);
  });

  it('guessing codes does not get a fresh budget by changing address', async () => {
    const chi = await t.user('chi@mfa.vn', 'Chi MFA');
    const setup = MfaSetup.parse(
      (await t.call(chi.auth, 'POST', '/auth/mfa/setup', { password: chi.password })).json(),
    );
    await t.call(chi.auth, 'POST', '/auth/mfa/enable', {
      code: totpAt(setup.secret, stepAt(Date.now())),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      statuses.push((await login(chi.email, chi.password, '222222', `10.9.1.${i + 1}`)).statusCode);
    }
    expect(statuses).toContain(429);
    // Even the right code is refused while the budget is spent.
    const right = totpAt(setup.secret, stepAt(Date.now()) + 1);
    expect((await login(chi.email, chi.password, right, '10.9.1.200')).statusCode).toBe(429);
  });
});
