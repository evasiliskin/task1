import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/rmq/logger.service';
import { type Collection } from 'mongodb';

import { type MongodbConfiguration } from '../../config/mongodb.config.js';

import { ArchiveProcessingService } from './archive-processing.service.js';

describe('ArchiveProcessingService', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-processing-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function buildService(
    collection: Collection<IGithubEventDocument>,
    warnMock: ReturnType<typeof vi.fn>,
  ): ArchiveProcessingService {
    const mongodbConfiguration: MongodbConfiguration = {
      uri: 'mongodb://localhost:27017/service_a',
      batchSize: 250,
    };
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new ArchiveProcessingService(collection, mongodbConfiguration, loggerService);
  }

  function writeGzippedArchive(lines: string[]): string {
    const filePath = join(storageDirectory, 'archive.json.gz');
    const gzipped = gzipSync(Buffer.from(`${lines.join('\n')}\n`));

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    writeFileSync(filePath, gzipped);

    return filePath;
  }

  it('should return the pipeline result using the injected batchSize and log invalid lines through the logger, when processing an archive with valid and invalid lines', async () => {
    const validLine = JSON.stringify({
      id: '1',
      type: 'WatchEvent',
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: {},
    });
    const filePath = writeGzippedArchive([validLine, 'not valid json']);
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;
    const warnMock = vi.fn();
    const service = buildService(collection, warnMock);

    const result = await service.process(filePath, 'import-1');

    expect(result).toEqual({
      eventsProcessed: 2,
      validEvents: 1,
      invalidEvents: 1,
      duplicateEvents: 0,
      errorCount: 0,
    });
    expect(insertMany).toHaveBeenCalledWith(
      [expect.objectContaining({ eventId: '1', importId: 'import-1' })],
      { ordered: false },
    );
    expect(warnMock).toHaveBeenCalledWith(
      { importId: 'import-1', rawLine: 'not valid json' },
      'Skipped invalid archive line',
      expect.anything(),
    );
  });

  it('should propagate ArchiveProcessingError, when the archive file does not exist', async () => {
    const missingPath = join(storageDirectory, 'does-not-exist.json.gz');
    const collection = { insertMany: vi.fn() } as unknown as Collection<IGithubEventDocument>;
    const warnMock = vi.fn();
    const service = buildService(collection, warnMock);

    await expect(service.process(missingPath, 'import-1')).rejects.toThrow();
  });
});
