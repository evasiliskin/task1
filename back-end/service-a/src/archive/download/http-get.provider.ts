import { get as httpsGet } from 'node:https';

import { type HttpGetFunction } from './fetch-archive-stream.js';

export const HTTP_GET = 'HTTP_GET';

export const httpGetProvider = {
  provide: HTTP_GET,
  useValue: httpsGet as HttpGetFunction,
};
