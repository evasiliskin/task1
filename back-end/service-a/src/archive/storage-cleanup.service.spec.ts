import { readdir, unlink } from 'node:fs/promises';

import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { type StorageConfiguration } from '../config/storage.config.js';

import { StorageCleanupService } from './storage-cleanup.service.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

describe('StorageCleanupService', () => {
  const storageConfiguration: StorageConfiguration = { dir: '/data/archives' };
  const loggerService = { getLogger: () => ({ info: vi.fn(), warn: vi.fn() }) };
  const requestContextService = new RequestContextService();

  it('should delete only .tmp files left behind by an interrupted download', async () => {
    vi.mocked(readdir).mockResolvedValue([
      '2026-08-11-0.json.gz.tmp',
      '2026-08-11-1.json.gz',
    ] as never);
    vi.mocked(unlink).mockResolvedValue(undefined);

    const service = new StorageCleanupService(
      storageConfiguration,
      requestContextService,
      loggerService as never,
    );
    await service.onModuleInit();

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith('\\data\\archives\\2026-08-11-0.json.gz.tmp');
  });

  it('should not prevent startup when the storage directory does not exist yet', async () => {
    vi.mocked(readdir).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const service = new StorageCleanupService(
      storageConfiguration,
      requestContextService,
      loggerService as never,
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
