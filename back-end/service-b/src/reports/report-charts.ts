import type PDFDocument from 'pdfkit';

import { type IImportTimeSeriesPoint } from '../processing-log/stats/derive-import-duration-stats.js';
import { type IStatsResult } from '../processing-log/stats/get-stats.js';

export type PdfDocument = InstanceType<typeof PDFDocument>;

const TIME_CHART_WIDTH = 400;
const TIME_CHART_HEIGHT = 120;
/** Chart height plus the tick-label row and the x-axis name, so the next section cannot overlap. */
const TIME_CHART_BOTTOM_MARGIN = 45;
const SINGLE_POINT_MARKER_RADIUS = 3;
const AXIS_LABEL_OFFSET_X = 25;
/**
 * A tick label is never narrower than this, so it doubles as the collision budget: the 50 points
 * `TS.RANGE` can return would be an unreadable smear at 8pt across 400pt. The tick count is derived
 * from it by `maxTicksForWidth` rather than fixed, so widening the chart yields more dates instead
 * of the same four stretched further apart.
 */
const TICK_LABEL_WIDTH = 60;
/** Two ticks — the first and the last point — are the least that still conveys a time range. */
const MIN_AXIS_TICKS = 2;
const TICK_LABEL_OFFSET_Y = 6;
const AXIS_NAME_OFFSET_Y = 22;
const AXIS_LABEL_FONT_SIZE = 8;
const AGGREGATE_Y_AXIS_NAME = 'Events';
const SINGLE_IMPORT_Y_AXIS_NAME = 'Duration (ms)';
const X_AXIS_NAME = 'Time (UTC)';

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

/**
 * Up to `maxTicks` evenly spaced point indices, always including the first and the last.
 *
 * Distinctness is guaranteed without deduplication: `step` is `(pointCount - 1) / (tickCount - 1)`
 * and `tickCount <= pointCount`, so `step >= 1` and consecutive rounded indices cannot collide.
 */
export function selectTickIndices(pointCount: number, maxTicks: number): number[] {
  if (pointCount <= 0) {
    return [];
  }

  const tickCount = Math.min(pointCount, maxTicks);

  if (tickCount === 1) {
    return [0];
  }

  const step = (pointCount - 1) / (tickCount - 1);
  const indices: number[] = [];

  for (let tick = 0; tick < tickCount; tick += 1) {
    indices.push(Math.round(tick * step));
  }

  return indices;
}

/**
 * How many tick labels of `labelWidth` fit across `chartWidth` without touching.
 *
 * `n` ticks sit `chartWidth / (n - 1)` apart. Flooring gives `n <= chartWidth / labelWidth`, hence
 * `n - 1 < chartWidth / labelWidth`, hence that spacing is strictly wider than a label — so no two
 * labels can touch, with a whole label's width still in hand. Below two labels' worth of width the
 * floor would drop to one or zero and the chart would lose its time range entirely, so it clamps.
 */
export function maxTicksForWidth(chartWidth: number, labelWidth: number): number {
  return Math.max(MIN_AXIS_TICKS, Math.floor(chartWidth / labelWidth));
}

/**
 * `2026-08-11T13:45:00.000Z` -> `08-11 13:45`.
 *
 * Sliced rather than parsed through `Date`: every timestamp reaching here was produced by
 * `toISOString()` upstream (`StatsMetricsReader.readEventsTimeSeries`,
 * `deriveImportDurationStats`), so the offsets are fixed, and slicing cannot drift the rendered
 * value into the host's local timezone the way `toLocaleString` would.
 */
export function formatAxisTimestamp(isoTimestamp: string): string {
  return `${isoTimestamp.slice(5, 10)} ${isoTimestamp.slice(11, 16)}`;
}

function pointX(index: number, pointCount: number, originX: number): number {
  if (pointCount === 1) {
    return originX;
  }

  return originX + index * (TIME_CHART_WIDTH / (pointCount - 1));
}

function drawYAxisLabels(
  pdf: PdfDocument,
  originX: number,
  originY: number,
  maxValue: number,
): void {
  pdf.x = originX - AXIS_LABEL_OFFSET_X;
  pdf.y = originY;
  pdf.fontSize(AXIS_LABEL_FONT_SIZE).text(String(maxValue));

  pdf.x = originX - AXIS_LABEL_OFFSET_X;
  pdf.y = originY + TIME_CHART_HEIGHT - 4;
  pdf.fontSize(AXIS_LABEL_FONT_SIZE).text('0');

  pdf.x = originX;
}

function drawXAxisTicks(
  pdf: PdfDocument,
  timeSeries: IImportTimeSeriesPoint[],
  originX: number,
  originY: number,
): void {
  const tickY = originY + TIME_CHART_HEIGHT + TICK_LABEL_OFFSET_Y;

  const maxTicks = maxTicksForWidth(TIME_CHART_WIDTH, TICK_LABEL_WIDTH);

  selectTickIndices(timeSeries.length, maxTicks).forEach((index) => {
    const point = timeSeries.at(index);

    if (point === undefined) {
      return;
    }

    const x = pointX(index, timeSeries.length, originX);

    pdf
      .fontSize(AXIS_LABEL_FONT_SIZE)
      .text(formatAxisTimestamp(point.timestamp), x - TICK_LABEL_WIDTH / 2, tickY, {
        width: TICK_LABEL_WIDTH,
        align: 'center',
      });
  });

  pdf.x = originX;
}

function drawAxisNames(
  pdf: PdfDocument,
  originX: number,
  originY: number,
  isAggregate: boolean,
): void {
  pdf.x = originX - AXIS_LABEL_OFFSET_X;
  pdf.y = originY - AXIS_LABEL_FONT_SIZE - 2;
  pdf
    .fontSize(AXIS_LABEL_FONT_SIZE)
    .text(isAggregate ? AGGREGATE_Y_AXIS_NAME : SINGLE_IMPORT_Y_AXIS_NAME);

  pdf
    .fontSize(AXIS_LABEL_FONT_SIZE)
    .text(X_AXIS_NAME, originX, originY + TIME_CHART_HEIGHT + AXIS_NAME_OFFSET_Y, {
      width: TIME_CHART_WIDTH,
      align: 'center',
    });

  pdf.x = originX;
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
    timeSeries.forEach((point, index) => {
      const x = pointX(index, timeSeries.length, originX);
      const y = originY + TIME_CHART_HEIGHT - (point.value / maxValue) * TIME_CHART_HEIGHT;

      if (index === 0) {
        pdf.moveTo(x, y);

        return;
      }

      pdf.lineTo(x, y);
    });

    pdf.stroke();
  }

  // Labelling runs for both branches. It used to sit inside the multi-point branch, which left a
  // single-point chart — the shape every per-import report produces — with no scale at all.
  drawYAxisLabels(pdf, originX, originY, maxValue);
  drawXAxisTicks(pdf, timeSeries, originX, originY);
  drawAxisNames(pdf, originX, originY, isAggregate);

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
