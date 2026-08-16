import { get as httpsGet } from 'node:https';

import { type HttpGetFunction } from './fetch-archive-stream.js';

export const HTTP_GET = 'HTTP_GET';

/**
 * The HTTP getter used to fetch archives, injected rather than passed as an optional argument.
 *
 * It was previously an optional parameter on two production signatures that existed only so tests
 * could substitute a fake — a test concern on the public surface. As a provider, tests override the
 * token and production callers never see it.
 */
export const httpGetProvider = {
  provide: HTTP_GET,
  useValue: httpsGet as HttpGetFunction,
};
