import { mkdtempSync, rmSync } from 'node:fs';
import { type ClientRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { type ArchiveConfiguration } from '../../config/archive.config.js';
import { type StorageConfiguration } from '../../config/storage.config.js';

import { ArchiveDownloadService } from './archive-download.service.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

describe('ArchiveDownloadService', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-download-service-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function buildService(): ArchiveDownloadService {
    const archiveConfiguration: ArchiveConfiguration = {
      baseUrl: 'https://data.gharchive.org',
      downloadTimeoutMs: 1000,
    };
    const storageConfiguration: StorageConfiguration = { dir: storageDirectory };

    return new ArchiveDownloadService(archiveConfiguration, storageConfiguration);
  }

  const buildSuccessfulHttpGet = (content: string): HttpGetFunction => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };

    return vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([content]) as unknown as IncomingMessage;
      response.statusCode = 200;

      callback(response);

      return fakeRequest as unknown as ClientRequest;
    });
  };

  it('should download using the injected config and return the final file path, when given a valid dateHour', async () => {
    const httpGet = buildSuccessfulHttpGet('fake gzip content');
    const service = buildService();

    const result = await service.download('2026-08-11-0', httpGet);

    expect(result.filePath).toBe(join(storageDirectory, '2026-08-11-0.json.gz'));
  });
});
