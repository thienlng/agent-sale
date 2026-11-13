import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { S3WebchatUploadStorage } from '../infrastructure/media/s3-webchat-upload-storage.js';

const storage = () =>
  new S3WebchatUploadStorage({
    endpoint: 'https://s3.test',
    bucket: 'media',
    publicUrl: 'https://cdn.test',
    accessKey: 'test-access',
    secretKey: 'test-secret',
  });

afterEach(() => vi.restoreAllMocks());

describe('S3WebchatUploadStorage.promote', () => {
  it('copies the temporary upload to its permanent key, then deletes the temporary copy', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const url = await storage().promote('webchat-tmp/w/c/a.png', 'webchat/w/c/a.png');
    expect(url).toBe('https://cdn.test/webchat/w/c/a.png');
    const commands = send.mock.calls.map((c) => c[0]);
    expect(commands[0]).toBeInstanceOf(CopyObjectCommand);
    expect(commands[1]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[1] as DeleteObjectCommand).input).toEqual({
      Bucket: 'media',
      Key: 'webchat-tmp/w/c/a.png',
    });
  });

  it('still returns the permanent url when deleting the temporary copy fails', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) throw new Error('denied');
      return {} as never;
    });
    expect(await storage().promote('webchat-tmp/w/c/a.png', 'webchat/w/c/a.png')).toBe(
      'https://cdn.test/webchat/w/c/a.png',
    );
  });

  it('answers a retried send from the permanent object once the temporary one is gone', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof CopyObjectCommand) throw new Error('NoSuchKey');
      if (command instanceof HeadObjectCommand) return {} as never;
      throw new Error('unexpected');
    });
    expect(await storage().promote('webchat-tmp/w/c/a.png', 'webchat/w/c/a.png')).toBe(
      'https://cdn.test/webchat/w/c/a.png',
    );
  });
});
