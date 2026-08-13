import { randomUUID } from 'node:crypto';

const PDF_EXTENSION = '.pdf';

export function buildReportFilename(importId?: string): string {
  const id = importId ?? randomUUID();

  return `${id}${PDF_EXTENSION}`;
}
