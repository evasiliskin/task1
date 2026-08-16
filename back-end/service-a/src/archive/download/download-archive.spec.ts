import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { type ClientRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { downloadArchive, type IDownloadArchiveOptions } from './download-archive.js';
import { ArchiveDownloadError, InvalidDateHourError } from './errors.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

describe('downloadArchive', () => {
  let storageDirectory: string;

  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-download-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  const buildOptions = (
    overrides: Partial<IDownloadArchiveOptions> = {},
  ): IDownloadArchiveOptions => ({
    baseUrl: 'https://data.gharchive.org',
    storageDirectory,
    timeoutMs: 1000,
    totalTimeoutMs: 5000,
    maxAttempts: 1,
    retryDelayMs: 10,
    ...overrides,
  });

  const buildSuccessfulHttpGet = (content: string): HttpGetFunction => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };

    return vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([content]) as unknown as IncomingMessage;
      response.statusCode = 200;

      callback(response);

      return fakeRequest as unknown as ClientRequest;
    });
  };

  const buildHttpGet = (): HttpGetFunction => buildSuccessfulHttpGet('fake gzip content');

  const buildFailingHttpGet = (statusCode: number): HttpGetFunction => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };

    return vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = Readable.from([]) as unknown as IncomingMessage;
      response.statusCode = statusCode;

      callback(response);

      return fakeRequest as unknown as ClientRequest;
    });
  };

  it('should write the archive to the final path, when the download succeeds', async () => {
    const httpGet = buildSuccessfulHttpGet('fake gzip content');

    const result = await downloadArchive('2026-08-11-0', importId, buildOptions(), httpGet);

    expect(result.filePath).toBe(join(storageDirectory, `${importId}.json.gz`));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(result.filePath)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(readFileSync(result.filePath, 'utf8')).toBe('fake gzip content');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(join(storageDirectory, `${importId}.download.tmp`))).toBe(false);
  });

  it('should write to an importId-keyed path so concurrent same-hour imports cannot collide', async () => {
    const importId = '11111111-1111-4111-8111-111111111111';

    const result = await downloadArchive('2026-08-11-0', importId, buildOptions(), buildHttpGet());

    expect(result.filePath).toBe(join(storageDirectory, `${importId}.json.gz`));
  });

  it('should leave no temp file behind on success', async () => {
    const importId = '22222222-2222-4222-8222-222222222222';

    await downloadArchive('2026-08-11-0', importId, buildOptions(), buildHttpGet());

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(readdirSync(storageDirectory)).toEqual([`${importId}.json.gz`]);
  });

  it('should throw InvalidDateHourError and write no file, when dateHour is malformed', async () => {
    const httpGet = buildSuccessfulHttpGet('unused');

    await expect(downloadArchive('not-a-date', importId, buildOptions(), httpGet)).rejects.toThrow(
      InvalidDateHourError,
    );
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('should throw ArchiveDownloadError and leave no final or temp file, when the response is a 404', async () => {
    const httpGet = buildFailingHttpGet(404);
    const finalPath = join(storageDirectory, `${importId}.json.gz`);

    await expect(
      downloadArchive('2026-08-11-0', importId, buildOptions(), httpGet),
    ).rejects.toThrow(ArchiveDownloadError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(finalPath)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(join(storageDirectory, `${importId}.download.tmp`))).toBe(false);
  });

  it('should clean up the temp file and rethrow, when the response stream errors mid-download', async () => {
    const fakeRequest = { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    const httpGet: HttpGetFunction = vi.fn(
      (_url: string, callback: (response: IncomingMessage) => void) => {
        const response = new Readable({
          read(): void {
            this.destroy(new Error('connection dropped'));
          },
        }) as unknown as IncomingMessage;
        response.statusCode = 200;

        callback(response);

        return fakeRequest as unknown as ClientRequest;
      },
    );
    const finalPath = join(storageDirectory, `${importId}.json.gz`);

    await expect(
      downloadArchive('2026-08-11-0', importId, buildOptions(), httpGet),
    ).rejects.toThrow(ArchiveDownloadError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(finalPath)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(join(storageDirectory, `${importId}.download.tmp`))).toBe(false);
  });

  it('should abort the download and clean up the temp file, when the body stalls past the total timeout', async () => {
    // Captured before faking timers: downloadArchive awaits a real fs/promises mkdir() before
    // the total-timeout guard is armed, so we need a real (unfaked) tick to let that I/O settle
    // before advancing the fake clock — otherwise the timer is armed after the virtual-time jump
    // and never fires.
    const realSetImmediate = setImmediate;
    vi.useFakeTimers();

    const options = buildOptions();
    const stalledBody = new PassThrough();
    const httpGetMock = vi.fn((_url: string, callback: (response: IncomingMessage) => void) => {
      callback(
        Object.assign(stalledBody, {
          statusCode: 200,
          resume: vi.fn(),
        }) as unknown as IncomingMessage,
      );

      return { setTimeout: vi.fn(), on: vi.fn(), destroy: vi.fn() } as unknown as ClientRequest;
    });
    const httpGet: HttpGetFunction = httpGetMock;

    const promise = downloadArchive('2026-08-11-0', importId, options, httpGet);

    while (httpGetMock.mock.calls.length === 0) {
      await new Promise((resolve) => realSetImmediate(resolve));
    }
    await vi.advanceTimersByTimeAsync(options.totalTimeoutMs + 1);

    await expect(promise).rejects.toThrow(/timed out/);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(join(storageDirectory, `${importId}.download.tmp`))).toBe(false);

    vi.useRealTimers();
  });

  describe('retries', () => {
    let options: IDownloadArchiveOptions;

    beforeEach(() => {
      options = {
        baseUrl: 'https://data.gharchive.org',
        storageDirectory,
        timeoutMs: 1000,
        totalTimeoutMs: 5000,
        maxAttempts: 3,
        retryDelayMs: 10,
      };
    });

    const respondWith =
      (statusCode: number, body: Buffer | string = ''): HttpGetFunction =>
      (_url: string, callback: (response: IncomingMessage) => void): ClientRequest => {
        const response = Readable.from([body]) as unknown as IncomingMessage;
        response.statusCode = statusCode;

        callback(response);

        return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() } as unknown as ClientRequest;
      };

    it('should retry a 503 and succeed on the second attempt', async () => {
      const httpGet = vi
        .fn()
        .mockImplementationOnce(respondWith(503))
        .mockImplementationOnce(respondWith(200, gzipSync(Buffer.from('{}'))));

      await expect(downloadArchive('2026-08-11-0', importId, options, httpGet)).resolves.toEqual({
        filePath: join(storageDirectory, `${importId}.json.gz`),
      });
      expect(httpGet).toHaveBeenCalledTimes(2);
    });

    it('should not retry a 404, because the archive hour does not exist and never will on this attempt cycle', async () => {
      const httpGet = vi.fn().mockImplementation(respondWith(404));

      await expect(downloadArchive('2999-01-01-0', importId, options, httpGet)).rejects.toThrow(
        /HTTP 404/,
      );
      expect(httpGet).toHaveBeenCalledTimes(1);
    });
  });
});
