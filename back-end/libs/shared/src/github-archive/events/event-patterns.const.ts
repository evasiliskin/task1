export const EVENT_PATTERNS = {
  IMPORT_STARTED: 'github.import.started',
  IMPORT_COMPLETED: 'github.import.completed',
  IMPORT_FAILED: 'github.import.failed',
} as const;

export type EventPattern = (typeof EVENT_PATTERNS)[keyof typeof EVENT_PATTERNS];
