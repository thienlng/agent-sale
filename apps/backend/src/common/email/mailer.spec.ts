import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EnvSchema } from '../config.js';

import { LocalMailer } from './mailer.js';

const message = { to: 'lan@shop.vn', subject: 'Mã: 123456', text: '123456', html: '<p>123456</p>' };
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('LocalMailer', () => {
  it('writes each email to the outbox directory in development', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'mail-')), 'outbox');
    dirs.push(dir);
    await new LocalMailer('development', dir).send(message);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, files[0] as string), 'utf8'))).toEqual(message);
  });

  it('keeps test emails in memory only', async () => {
    const mailer = new LocalMailer('test', join(tmpdir(), 'never-created-outbox'));
    await mailer.send(message);
    expect(mailer.sent).toEqual([message]);
    await expect(readdir(join(tmpdir(), 'never-created-outbox'))).rejects.toThrow();
  });

  it('refuses an outbox directory in production', () => {
    const parsed = EnvSchema.safeParse({
      NODE_ENV: 'production',
      MAIL_OUTBOX_DIR: '/tmp/x',
      SECRETS_ENCRYPTION_KEY: 'x'.repeat(44),
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('MAIL_OUTBOX_DIR');
  });
});
