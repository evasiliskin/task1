export const RPC_PATTERNS = {
  EVENTS_SEARCH: 'events.search',
  LOGS_SEARCH: 'logs.search',
  STATS_GET: 'stats.get',
  REPORTS_PDF_GENERATE: 'reports.pdf.generate',
  IMPORTS_STATUS_GET: 'imports.status.get',
  ARCHIVE_IMPORT_DOWNLOAD: 'archive.import.download',
  ARCHIVE_PROCESS_UPLOAD: 'archive.process.upload',
  HEALTH_CHECK: 'health.check',
} as const;

export type RpcPattern = (typeof RPC_PATTERNS)[keyof typeof RPC_PATTERNS];
