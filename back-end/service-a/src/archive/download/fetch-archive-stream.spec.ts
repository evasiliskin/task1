import { type ClientRequest, type IncomingMessage } from 'node:http';

import { ArchiveDownloadError } from './errors.js';
import { fetchArchiveStream, type HttpGetFunction } from './fetch-archive-stream.js';

describe('fetchArchiveStream', () => {
  const url = 'https://data.gharchive.org/2026-08-11-0.json.gz';

  const buildFakeRequest = (): {
    on: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  } => ({
    on: vi.fn(),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
  });

  it('should resolve with the response, when the request succeeds with a 2xx status', async () => {
    const response = { statusCode: 200 } as unknown as IncomingMessage;
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(
      (_url: string, callback: (response: IncomingMessage) => void) => {
        callback(response);

        return fakeRequest as unknown as ClientRequest;
      },
    );

    await expect(fetchArchiveStream(url, 1000, httpGet)).resolves.toBe(response);
  });

  it('should reject with ArchiveDownloadError, when the response status is not 2xx', async () => {
    const resume = vi.fn();
    const response = { statusCode: 404, resume } as unknown as IncomingMessage;
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(
      (_url: string, callback: (response: IncomingMessage) => void) => {
        callback(response);

        return fakeRequest as unknown as ClientRequest;
      },
    );

    await expect(fetchArchiveStream(url, 1000, httpGet)).rejects.toThrow(ArchiveDownloadError);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('should reject with ArchiveDownloadError, when the request emits an error event', async () => {
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(() => fakeRequest as unknown as ClientRequest);

    const promise = fetchArchiveStream(url, 1000, httpGet);

    const errorHandler = fakeRequest.on.mock.calls.find(([event]) => event === 'error')?.[1] as (
      error: Error,
    ) => void;
    errorHandler(new Error('connection refused'));

    await expect(promise).rejects.toThrow(ArchiveDownloadError);
  });

  it('should destroy the request and reject, when the configured timeout elapses', async () => {
    const fakeRequest = buildFakeRequest();
    const httpGet: HttpGetFunction = vi.fn(() => fakeRequest as unknown as ClientRequest);

    const promise = fetchArchiveStream(url, 5000, httpGet);

    expect(fakeRequest.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function));

    const onTimeout = fakeRequest.setTimeout.mock.calls[0]?.[1] as () => void;
    onTimeout();

    expect(fakeRequest.destroy).toHaveBeenCalledWith(expect.any(Error));

    const errorHandler = fakeRequest.on.mock.calls.find(([event]) => event === 'error')?.[1] as (
      error: Error,
    ) => void;
    errorHandler(fakeRequest.destroy.mock.calls[0]?.[0] as Error);

    await expect(promise).rejects.toThrow(ArchiveDownloadError);
  });
});
