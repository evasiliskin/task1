import { get as httpsGet } from 'node:https';

import { HTTP_GET, httpGetProvider } from './http-get.provider.js';

describe('httpGetProvider', () => {
  it('should provide node https.get, when no override is supplied', () => {
    expect(httpGetProvider.provide).toBe(HTTP_GET);
    expect(httpGetProvider.useValue).toBe(httpsGet);
  });
});
