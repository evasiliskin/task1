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

  function buildService(httpGet: HttpGetFunction): ArchiveDownloadService {
    const archiveConfiguration: ArchiveConfiguration = {
      baseUrl: 'https://data.gharchive.org',
      downloadTimeoutMs: 1000,
      downloadTotalTimeoutMs: 5000,
      downloadMaxAttempts: 3,
      downloadRetryDelayMs: 10,
      maxDecompressedBytes: 4_294_967_296,
      maxLineBytes: 1_048_576,
      shutdownDrainTimeoutMs: 60_000,
    };
    const storageConfiguration: StorageConfiguration = { dir: storageDirectory };

    return new ArchiveDownloadService(archiveConfiguration, storageConfiguration, httpGet);
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
    const service = buildService(httpGet);
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    const result = await service.download('2026-08-11-0', importId);

    expect(result.filePath).toBe(join(storageDirectory, `${importId}.json.gz`));
  });
});
