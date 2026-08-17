import type PDFDocument from 'pdfkit';

import { type IImportTimeSeriesPoint } from '../processing-log/stats/derive-import-duration-stats.js';
import { type IStatsResult } from '../processing-log/stats/get-stats.js';

export type PdfDocument = InstanceType<typeof PDFDocument>;

const TIME_CHART_WIDTH = 400;
const TIME_CHART_HEIGHT = 120;
const TIME_CHART_BOTTOM_MARGIN = 20;
const SINGLE_POINT_MARKER_RADIUS = 3;
const AXIS_LABEL_OFFSET_X = 25;

const BAR_CHART_HEIGHT = 120;
const BAR_WIDTH = 60;
const BAR_GAP = 40;
const BAR_CHART_BOTTOM_MARGIN = 25;
const SUCCESSFUL_BAR_COLOR = '#2E7D32';
const INVALID_BAR_COLOR = '#F9A825';
const ERROR_BAR_COLOR = '#C62828';

const AGGREGATE_CHART_TITLE = 'Events Processed Over Time';
const SINGLE_IMPORT_CHART_TITLE = 'Processing Duration (this import)';

interface IBreakdownBar {
  label: string;
  value: number;
  color: string;
}

export function drawSummarySection(
  pdf: PdfDocument,
  stats: IStatsResult,
  isAggregate: boolean,
): void {
  pdf.fontSize(14).text('Summary', { underline: true });
  pdf.moveDown(0.5);
  pdf.fontSize(11);
  pdf.text(`Report scope: ${isAggregate ? 'all imports' : 'single import'}`);

  if (stats.degraded) {
    pdf
      .fillColor('#C62828')
      .text('Warning: some data sources were unavailable; figures may be incomplete.');
    pdf.fillColor('black');
  }

  pdf.text(`Archives processed: ${stats.archivesProcessed}`);
  pdf.text(`Events processed: ${stats.eventsProcessed}`);
  pdf.text(`Successful events: ${stats.successfulEvents}`);
  pdf.text(`Invalid events: ${stats.invalidEvents}`);
  pdf.text(`Errors: ${stats.errors}`);
  pdf.text(
    stats.processingDurationMs === undefined
      ? 'Processing duration: n/a'
      : `Processing duration: ${stats.processingDurationMs} ms`,
  );
}

export function drawEventsOverTimeChart(
  pdf: PdfDocument,
  timeSeries: IImportTimeSeriesPoint[],
  isAggregate: boolean,
): void {
  pdf
    .fontSize(14)
    .text(isAggregate ? AGGREGATE_CHART_TITLE : SINGLE_IMPORT_CHART_TITLE, { underline: true });
  pdf.moveDown(0.5);

  if (timeSeries.length === 0) {
    pdf.fontSize(11).text('No data available to draw a chart.');

    return;
  }

  const originX = pdf.x;
  const originY = pdf.y;
  const maxValue = Math.max(...timeSeries.map((point) => point.value), 1);

  pdf
    .moveTo(originX, originY + TIME_CHART_HEIGHT)
    .lineTo(originX + TIME_CHART_WIDTH, originY + TIME_CHART_HEIGHT)
    .stroke();

  if (timeSeries.length === 1) {
    const [point] = timeSeries;
    const y = originY + TIME_CHART_HEIGHT - (point.value / maxValue) * TIME_CHART_HEIGHT;

    pdf.circle(originX, y, SINGLE_POINT_MARKER_RADIUS).fill('black');
  } else {
    const stepX = TIME_CHART_WIDTH / (timeSeries.length - 1);

    timeSeries.forEach((point, index) => {
      const x = originX + index * stepX;
      const y = originY + TIME_CHART_HEIGHT - (point.value / maxValue) * TIME_CHART_HEIGHT;

      if (index === 0) {
        pdf.moveTo(x, y);

        return;
      }

      pdf.lineTo(x, y);
    });

    pdf.stroke();

    pdf.x = originX - AXIS_LABEL_OFFSET_X;
    pdf.y = originY;
    pdf.fontSize(8).text(String(maxValue));

    pdf.x = originX - AXIS_LABEL_OFFSET_X;
    pdf.y = originY + TIME_CHART_HEIGHT - 4;
    pdf.fontSize(8).text('0');

    pdf.x = originX;
  }

  pdf.y = originY + TIME_CHART_HEIGHT + TIME_CHART_BOTTOM_MARGIN;
}

export function drawStatusBreakdownChart(pdf: PdfDocument, stats: IStatsResult): void {
  pdf.fontSize(14).text('Event Outcome Breakdown', { underline: true });
  pdf.moveDown(0.5);

  const originX = pdf.x;
  const originY = pdf.y;
  const bars: IBreakdownBar[] = [
    { label: 'Successful', value: stats.successfulEvents, color: SUCCESSFUL_BAR_COLOR },
    { label: 'Invalid', value: stats.invalidEvents, color: INVALID_BAR_COLOR },
    { label: 'Errors', value: stats.errors, color: ERROR_BAR_COLOR },
  ];
  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);

  bars.forEach((bar, index) => {
    const barHeight = (bar.value / maxValue) * BAR_CHART_HEIGHT;
    const x = originX + index * (BAR_WIDTH + BAR_GAP);
    const y = originY + BAR_CHART_HEIGHT - barHeight;

    pdf.rect(x, y, BAR_WIDTH, barHeight).fill(bar.color);
    pdf
      .fillColor('black')
      .fontSize(9)
      .text(`${bar.label}: ${bar.value}`, x, originY + BAR_CHART_HEIGHT + 5, {
        width: BAR_WIDTH + BAR_GAP,
      });
  });

  pdf.y = originY + BAR_CHART_HEIGHT + BAR_CHART_BOTTOM_MARGIN;
}
