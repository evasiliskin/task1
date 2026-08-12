import { type ClientRequest, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';

import { ArchiveDownloadError } from './errors.js';

export type HttpGetFunction = (
  url: string,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export function fetchArchiveStream(
  url: string,
  timeoutMs: number,
  httpGet: HttpGetFunction = httpsGet,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();

        reject(
          new ArchiveDownloadError(
            `Archive download failed with HTTP ${statusCode}`,
            url,
            statusCode,
          ),
        );

        return;
      }

      resolve(response);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      reject(
        new ArchiveDownloadError(
          `Archive download request failed: ${error.message}`,
          url,
          undefined,
          error,
        ),
      );
    });
  });
}
