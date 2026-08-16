import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { type LoggerService } from '@task1/shared/logger/logger.service';
import { type Collection } from 'mongodb';

import { type MongodbConfiguration } from '../../config/mongodb.config.js';
import type * as processArchiveModule from '../processing/process-archive.js';
import { processArchive } from '../processing/process-archive.js';

import { ArchiveProcessingService } from './archive-processing.service.js';

vi.mock('../processing/process-archive.js', async () => {
  const actual = await vi.importActual<typeof processArchiveModule>(
    '../processing/process-archive.js',
  );

  return { ...actual, processArchive: vi.fn(actual.processArchive) };
});

const IMPORT_ID = 'import-1';
const INVALID_LINE_COUNT = 50;
const LONG_LINE = 'x'.repeat(5000);

function buildCappedService(warn: ReturnType<typeof vi.fn>): ArchiveProcessingService {
  // The existing module-level `processArchive` mock is redirected to drive the invalid-line
  // callback INVALID_LINE_COUNT times, which is what the cap has to survive.
  vi.mocked(processArchive).mockImplementation((_filePath, _importId, _options, onInvalidLine) => {
    for (let index = 0; index < INVALID_LINE_COUNT; index += 1) {
      onInvalidLine?.(LONG_LINE, new Error('unparseable'));
    }

    return Promise.resolve({
      eventsProcessed: INVALID_LINE_COUNT,
      validEvents: 0,
      invalidEvents: INVALID_LINE_COUNT,
      duplicateEvents: 0,
      errorCount: 0,
    });
  });

  return new ArchiveProcessingService(
    {} as never,
    { batchSize: 500 } as never,
    { maxLineBytes: 1_048_576, maxDecompressedBytes: 4_294_967_296 } as never,
    { getLogger: () => ({ warn }) } as never,
  );
}

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
      insertConcurrency: 2,
    };
    const loggerService = {
      getLogger: vi.fn().mockReturnValue({ warn: warnMock }),
    } as unknown as LoggerService;

    return new ArchiveProcessingService(
      collection,
      mongodbConfiguration,
      { maxLineBytes: 1_048_576, maxDecompressedBytes: 4_294_967_296 } as never,
      loggerService,
    );
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
      { importId: 'import-1', rawLinePreview: 'not valid json', suppressingFurtherLines: false },
      'Skipped invalid archive line',
      expect.anything(),
    );
  });

  it('should log the write-error sample, when a batch reports non-duplicate errors', async () => {
    const validLine = JSON.stringify({
      id: '1',
      type: 'WatchEvent',
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: {},
    });
    const filePath = writeGzippedArchive([validLine]);
    const insertMany = vi.fn().mockRejectedValue(
      Object.assign(new Error('bulk write failed'), {
        name: 'MongoBulkWriteError',
        insertedCount: 0,
        writeErrors: [{ code: 121, errmsg: 'Document failed validation' }],
      }),
    );
    const collection = { insertMany } as unknown as Collection<IGithubEventDocument>;
    const warnMock = vi.fn();
    const service = buildService(collection, warnMock);

    await service.process(filePath, 'import-1');

    expect(warnMock).toHaveBeenCalledWith(
      {
        importId: 'import-1',
        errorCount: 1,
        errorSample: [{ code: 121, message: 'Document failed validation' }],
        suppressingFurtherLines: false,
      },
      'Batch insert reported non-duplicate write errors',
    );
  });

  it('should propagate ArchiveProcessingError, when the archive file does not exist', async () => {
    const missingPath = join(storageDirectory, 'does-not-exist.json.gz');
    const collection = { insertMany: vi.fn() } as unknown as Collection<IGithubEventDocument>;
    const warnMock = vi.fn();
    const service = buildService(collection, warnMock);

    await expect(service.process(missingPath, 'import-1')).rejects.toThrow();
  });

  it('should stop logging after the cap, when an archive is entirely invalid', async () => {
    const warn = vi.fn();

    await buildCappedService(warn).process('/tmp/archive.json.gz', IMPORT_ID);

    expect(warn).toHaveBeenCalledTimes(10);
    expect((warn.mock.calls.at(-1) as [Record<string, unknown>])[0]).toMatchObject({
      suppressingFurtherLines: true,
    });
  });

  it('should truncate the raw line, when it is longer than the preview length', async () => {
    const warn = vi.fn();

    await buildCappedService(warn).process('/tmp/archive.json.gz', IMPORT_ID);

    const [fields] = warn.mock.calls[0] as [{ rawLinePreview: string }];

    expect(fields.rawLinePreview).toHaveLength(200);
  });

  it('should pass the configured bounds and concurrency through to processArchive', async () => {
    vi.mocked(processArchive).mockResolvedValue({
      eventsProcessed: 0,
      validEvents: 0,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });

    const service = new ArchiveProcessingService(
      {} as never,
      { batchSize: 7, insertConcurrency: 3 } as never,
      { maxLineBytes: 45, maxDecompressedBytes: 123 } as never,
      { getLogger: () => ({ warn: vi.fn() }) } as never,
    );

    await service.process('/tmp/a.json.gz', IMPORT_ID);

    expect(processArchive).toHaveBeenCalledWith(
      '/tmp/a.json.gz',
      IMPORT_ID,
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.anything() is typed `any` by vitest; the matcher only cares that the field is present, not its type.
        collection: expect.anything(),
        batchSize: 7,
        insertConcurrency: 3,
        maxLineBytes: 45,
        maxDecompressedBytes: 123,
      },
      expect.any(Function),
      expect.any(Function),
    );
  });
});
