import { RPC_PATTERNS } from './rpc-patterns.const.js';

describe('RPC_PATTERNS', () => {
  it('should expose the exact wire strings, when the pattern constants are read', () => {
    expect(RPC_PATTERNS).toEqual({
      EVENTS_SEARCH: 'events.search',
      LOGS_SEARCH: 'logs.search',
      STATS_GET: 'stats.get',
      REPORTS_PDF_GENERATE: 'reports.pdf.generate',
      IMPORTS_STATUS_GET: 'imports.status.get',
      IMPORTS_CLAIM: 'imports.claim',
      HEALTH_CHECK: 'health.check',
    });
  });
});
