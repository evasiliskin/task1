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
  document_: PdfDocument,
  stats: IStatsResult,
  isAggregate: boolean,
): void {
  document_.fontSize(14).text('Summary', { underline: true });
  document_.moveDown(0.5);
  document_.fontSize(11);
  document_.text(`Report scope: ${isAggregate ? 'all imports' : 'single import'}`);
  document_.text(`Archives processed: ${stats.archivesProcessed}`);
  document_.text(`Events processed: ${stats.eventsProcessed}`);
  document_.text(`Successful events: ${stats.successfulEvents}`);
  document_.text(`Invalid events: ${stats.invalidEvents}`);
  document_.text(`Errors: ${stats.errors}`);
  document_.text(
    stats.processingDurationMs === undefined
      ? 'Processing duration: n/a'
      : `Processing duration: ${stats.processingDurationMs} ms`,
  );
}

export function drawEventsOverTimeChart(
  document_: PdfDocument,
  timeSeries: IImportTimeSeriesPoint[],
  isAggregate: boolean,
): void {
  document_
    .fontSize(14)
    .text(isAggregate ? AGGREGATE_CHART_TITLE : SINGLE_IMPORT_CHART_TITLE, { underline: true });
  document_.moveDown(0.5);

  if (timeSeries.length === 0) {
    document_.fontSize(11).text('No data available to draw a chart.');

    return;
  }

  const originX = document_.x;
  const originY = document_.y;
  const maxValue = Math.max(...timeSeries.map((point) => point.value), 1);

  document_
    .moveTo(originX, originY + TIME_CHART_HEIGHT)
    .lineTo(originX + TIME_CHART_WIDTH, originY + TIME_CHART_HEIGHT)
    .stroke();

  if (timeSeries.length === 1) {
    const [point] = timeSeries;
    const y = originY + TIME_CHART_HEIGHT - (point.value / maxValue) * TIME_CHART_HEIGHT;

    document_.circle(originX, y, SINGLE_POINT_MARKER_RADIUS).fill('black');
  } else {
    const stepX = TIME_CHART_WIDTH / (timeSeries.length - 1);

    timeSeries.forEach((point, index) => {
      const x = originX + index * stepX;
      const y = originY + TIME_CHART_HEIGHT - (point.value / maxValue) * TIME_CHART_HEIGHT;

      if (index === 0) {
        document_.moveTo(x, y);

        return;
      }

      document_.lineTo(x, y);
    });

    document_.stroke();

    document_.x = originX - AXIS_LABEL_OFFSET_X;
    document_.y = originY;
    document_.fontSize(8).text(String(maxValue));

    document_.x = originX - AXIS_LABEL_OFFSET_X;
    document_.y = originY + TIME_CHART_HEIGHT - 4;
    document_.fontSize(8).text('0');

    document_.x = originX;
  }

  document_.y = originY + TIME_CHART_HEIGHT + TIME_CHART_BOTTOM_MARGIN;
}

export function drawStatusBreakdownChart(document_: PdfDocument, stats: IStatsResult): void {
  document_.fontSize(14).text('Event Outcome Breakdown', { underline: true });
  document_.moveDown(0.5);

  const originX = document_.x;
  const originY = document_.y;
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

    document_.rect(x, y, BAR_WIDTH, barHeight).fill(bar.color);
    document_
      .fillColor('black')
      .fontSize(9)
      .text(`${bar.label}: ${bar.value}`, x, originY + BAR_CHART_HEIGHT + 5, {
        width: BAR_WIDTH + BAR_GAP,
      });
  });

  document_.y = originY + BAR_CHART_HEIGHT + BAR_CHART_BOTTOM_MARGIN;
}
