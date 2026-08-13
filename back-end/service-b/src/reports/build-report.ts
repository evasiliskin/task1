import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import PDFDocument from 'pdfkit';

import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import {
  drawEventsOverTimeChart,
  drawStatusBreakdownChart,
  drawSummarySection,
} from './report-charts.js';

export async function buildReport(stats: IStatsResult, reportPath: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reportPath is built from the configured report directory and a server-generated id, never raw external input.
  await mkdir(dirname(reportPath), { recursive: true });

  const document = new PDFDocument({ margin: 50 });

  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    const writeStream = createWriteStream(reportPath);

    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    document.on('error', reject);

    document.pipe(writeStream);

    document.fontSize(20).text('GitHub Archive Processing Report', { align: 'center' });
    document.moveDown();

    drawSummarySection(document, stats);
    document.moveDown();
    drawEventsOverTimeChart(document, stats.timeSeries);
    document.moveDown();
    drawStatusBreakdownChart(document, stats);

    document.end();
  });
}
