export const RPC_PATTERNS = {
  EVENTS_SEARCH: 'events.search',
  LOGS_SEARCH: 'logs.search',
  STATS_GET: 'stats.get',
  REPORTS_PDF_GENERATE: 'reports.pdf.generate',
  IMPORTS_STATUS_GET: 'imports.status.get',
  IMPORTS_CLAIM: 'imports.claim',
  HEALTH_CHECK: 'health.check',
} as const;

export type RpcPattern = (typeof RPC_PATTERNS)[keyof typeof RPC_PATTERNS];
