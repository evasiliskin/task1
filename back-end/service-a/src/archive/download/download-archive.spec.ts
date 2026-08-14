import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { type ClientRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { downloadArchive } from './download-archive.js';
import { ArchiveDownloadError, InvalidDateHourError } from './errors.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

describe('downloadArchive', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'archive-download-spec-'));
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
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

    const result = await downloadArchive(
      '2026-08-11-0',
      { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
      httpGet,
    );

    expect(result.filePath).toBe(join(storageDirectory, '2026-08-11-0.json.gz'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(result.filePath)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(readFileSync(result.filePath, 'utf8')).toBe('fake gzip content');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(`${result.filePath}.tmp`)).toBe(false);
  });

  it('should throw InvalidDateHourError and write no file, when dateHour is malformed', async () => {
    const httpGet = buildSuccessfulHttpGet('unused');

    await expect(
      downloadArchive(
        'not-a-date',
        { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
        httpGet,
      ),
    ).rejects.toThrow(InvalidDateHourError);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('should throw ArchiveDownloadError and leave no final or temp file, when the response is a 404', async () => {
    const httpGet = buildFailingHttpGet(404);
    const finalPath = join(storageDirectory, '2026-08-11-0.json.gz');

    await expect(
      downloadArchive(
        '2026-08-11-0',
        { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
        httpGet,
      ),
    ).rejects.toThrow(ArchiveDownloadError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(finalPath)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);
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
    const finalPath = join(storageDirectory, '2026-08-11-0.json.gz');

    await expect(
      downloadArchive(
        '2026-08-11-0',
        { baseUrl: 'https://data.gharchive.org', storageDirectory, timeoutMs: 1000 },
        httpGet,
      ),
    ).rejects.toThrow(ArchiveDownloadError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(finalPath)).toBe(false);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
    expect(existsSync(`${finalPath}.tmp`)).toBe(false);
  });
});
