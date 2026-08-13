import { randomUUID } from 'node:crypto';

const PDF_EXTENSION = '.pdf';

export function buildReportFilename(importId?: string): string {
  const uniqueSuffix = randomUUID();
  const id = importId === undefined ? uniqueSuffix : `${importId}-${uniqueSuffix}`;

  return `${id}${PDF_EXTENSION}`;
}
