import { type IStatsResult } from '../processing-log/stats/get-stats.js';

import {
  drawEventsOverTimeChart,
  drawStatusBreakdownChart,
  drawSummarySection,
  formatAxisTimestamp,
  maxTicksForWidth,
  selectTickIndices,
} from './report-charts.js';

function buildFakeDoc(extraMethods: string[] = []): Record<string, unknown> {
  const doc: Record<string, unknown> = { x: 50, y: 100 };
  const methods = ['fontSize', 'text', 'moveDown', ...extraMethods];

  methods.forEach((method) => {
    // eslint-disable-next-line security/detect-object-injection
    (doc as Record<string, ReturnType<typeof vi.fn>>)[method] = vi.fn().mockReturnValue(doc);
  });

  return doc;
}

describe('drawSummarySection', () => {
  it('should write six summary lines with a millisecond duration, when processingDurationMs is present', () => {
    const doc = buildFakeDoc();
    const stats: IStatsResult = {
      archivesProcessed: 3,
      eventsProcessed: 300,
      successfulEvents: 290,
      invalidEvents: 10,
      errors: 2,
      processingDurationMs: 15_000,
      timeSeries: [],
      degraded: false,
    };

    drawSummarySection(doc as never, stats, true);

    expect(doc.text).toHaveBeenCalledWith('Archives processed: 3');
    expect(doc.text).toHaveBeenCalledWith('Events processed: 300');
    expect(doc.text).toHaveBeenCalledWith('Successful events: 290');
    expect(doc.text).toHaveBeenCalledWith('Invalid events: 10');
    expect(doc.text).toHaveBeenCalledWith('Errors: 2');
    expect(doc.text).toHaveBeenCalledWith('Processing duration: 15000 ms');
  });

  it('should write "n/a" for the duration line, when processingDurationMs is undefined', () => {
    const doc = buildFakeDoc();
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    drawSummarySection(doc as never, stats, true);

    expect(doc.text).toHaveBeenCalledWith('Processing duration: n/a');
  });

  it('should write a degraded warning in red and reset the fill color, when stats.degraded is true', () => {
    const doc = buildFakeDoc(['fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: true,
    };

    drawSummarySection(doc as never, stats, true);

    expect(doc.fillColor).toHaveBeenCalledWith('#C62828');
    expect(doc.text).toHaveBeenCalledWith(
      'Warning: some data sources were unavailable; figures may be incomplete.',
    );
    expect(doc.fillColor).toHaveBeenCalledWith('black');
  });

  it('should not write a degraded warning, when stats.degraded is false', () => {
    const doc = buildFakeDoc(['fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    drawSummarySection(doc as never, stats, true);

    expect(doc.text).not.toHaveBeenCalledWith(
      'Warning: some data sources were unavailable; figures may be incomplete.',
    );
  });

  it('should write a report-scope line, when called with an aggregate-scope flag', () => {
    const doc = buildFakeDoc();
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    drawSummarySection(doc as never, stats, true);

    expect(doc.text).toHaveBeenCalledWith('Report scope: all imports');
  });

  it('should write a single-import report-scope line, when called with isAggregate false', () => {
    const doc = buildFakeDoc();
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    drawSummarySection(doc as never, stats, false);

    expect(doc.text).toHaveBeenCalledWith('Report scope: single import');
  });
});

describe('drawEventsOverTimeChart', () => {
  it('should write a "no data" message and draw no lines, when the series is empty', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(doc as never, [], true);

    expect(doc.text).toHaveBeenCalledWith('No data available to draw a chart.');
    expect(doc.moveTo).not.toHaveBeenCalled();
  });

  it('should title the chart "Events Processed Over Time" and draw axis min/max labels, when isAggregate is true and multiple points are given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);
    const timeSeries = [
      { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
      { timestamp: '2026-08-11T00:01:00.000Z', value: 20 },
      { timestamp: '2026-08-11T00:02:00.000Z', value: 5 },
    ];

    drawEventsOverTimeChart(doc as never, timeSeries, true);

    expect(doc.text).toHaveBeenCalledWith('Events Processed Over Time', { underline: true });
    expect(doc.text).toHaveBeenCalledWith('20');
    expect(doc.text).toHaveBeenCalledWith('0');
  });

  it('should title the chart "Processing Duration (this import)" and label the axis, when isAggregate is false and a single point is given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke', 'circle', 'fill']);

    drawEventsOverTimeChart(
      doc as never,
      [{ timestamp: '2026-08-11T00:00:00.000Z', value: 10 }],
      false,
    );

    expect(doc.text).toHaveBeenCalledWith('Processing Duration (this import)', {
      underline: true,
    });
    expect(doc.text).toHaveBeenCalledWith('10');
    expect(doc.text).toHaveBeenCalledWith('0');
    expect(doc.circle).toHaveBeenCalledTimes(1);
  });

  it('should advance doc.y below the fixed-height chart area, when only one point is given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke', 'circle', 'fill']);

    drawEventsOverTimeChart(
      doc as never,
      [{ timestamp: '2026-08-11T00:00:00.000Z', value: 10 }],
      true,
    );

    expect(doc.y).toBe(100 + 120 + 45);
  });

  it('should draw one axis line and one polyline, when 3 points are given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);
    const timeSeries = [
      { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
      { timestamp: '2026-08-11T00:01:00.000Z', value: 20 },
      { timestamp: '2026-08-11T00:02:00.000Z', value: 5 },
    ];

    drawEventsOverTimeChart(doc as never, timeSeries, true);

    expect(doc.moveTo).toHaveBeenCalledTimes(2);
    expect(doc.lineTo).toHaveBeenCalledTimes(3);
    expect(doc.stroke).toHaveBeenCalledTimes(2);
  });

  it('should advance doc.y below the fixed-height chart area, when points are drawn', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(
      doc as never,
      [
        { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
        { timestamp: '2026-08-11T00:01:00.000Z', value: 20 },
      ],
      true,
    );

    expect(doc.y).toBe(100 + 120 + 45);
  });

  it('should render a dated tick label for the first and last point, when multiple points are given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(
      doc as never,
      [
        { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
        { timestamp: '2026-08-12T06:30:00.000Z', value: 20 },
      ],
      true,
    );

    const rendered = (
      doc.text as ReturnType<
        typeof vi.fn<(text: string, options?: Record<string, unknown>) => unknown>
      >
    ).mock.calls.map((call) => call[0]);

    expect(rendered).toContain('08-11 00:00');
    expect(rendered).toContain('08-12 06:30');
  });

  it('should render a dated tick for the first and last point, when many points are given', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);
    const timeSeries = Array.from({ length: 50 }, (_, index) => ({
      timestamp: `2026-08-11T00:${String(index).padStart(2, '0')}:00.000Z`,
      value: index,
    }));

    drawEventsOverTimeChart(doc as never, timeSeries, true);

    const rendered = (
      doc.text as ReturnType<
        typeof vi.fn<(text: string, options?: Record<string, unknown>) => unknown>
      >
    ).mock.calls.map((call) => call[0]);
    const dated = rendered.filter((text) => /^\d{2}-\d{2} \d{2}:\d{2}$/.test(String(text)));

    expect(dated.at(0)).toBe('08-11 00:00');
    expect(dated.at(-1)).toBe('08-11 00:49');
    // 400pt of axis against a 60pt label budget — denser than the fixed four it replaced, and still
    // 80pt apart, so no two labels can touch.
    expect(dated).toHaveLength(6);
  });

  it('should name both axes with the aggregate metric, when isAggregate is true', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke']);

    drawEventsOverTimeChart(
      doc as never,
      [
        { timestamp: '2026-08-11T00:00:00.000Z', value: 10 },
        { timestamp: '2026-08-11T01:00:00.000Z', value: 20 },
      ],
      true,
    );

    const rendered = (
      doc.text as ReturnType<
        typeof vi.fn<(text: string, options?: Record<string, unknown>) => unknown>
      >
    ).mock.calls.map((call) => call[0]);

    expect(rendered).toContain('Events');
    expect(rendered).toContain('Time (UTC)');
  });

  it('should name the y-axis with the duration metric, when isAggregate is false', () => {
    const doc = buildFakeDoc(['moveTo', 'lineTo', 'stroke', 'circle', 'fill']);

    drawEventsOverTimeChart(
      doc as never,
      [{ timestamp: '2026-08-11T00:00:00.000Z', value: 10 }],
      false,
    );

    const rendered = (
      doc.text as ReturnType<
        typeof vi.fn<(text: string, options?: Record<string, unknown>) => unknown>
      >
    ).mock.calls.map((call) => call[0]);

    expect(rendered).toContain('Duration (ms)');
  });
});

describe('drawStatusBreakdownChart', () => {
  it('should draw 3 bars filled with their status colors, when called', () => {
    const doc = buildFakeDoc(['rect', 'fill', 'fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 1,
      eventsProcessed: 100,
      successfulEvents: 80,
      invalidEvents: 15,
      errors: 5,
      timeSeries: [],
      degraded: false,
    };

    drawStatusBreakdownChart(doc as never, stats);

    expect(doc.rect).toHaveBeenCalledTimes(3);
    expect(doc.fill).toHaveBeenCalledWith('#2E7D32');
    expect(doc.fill).toHaveBeenCalledWith('#F9A825');
    expect(doc.fill).toHaveBeenCalledWith('#C62828');
  });

  it('should draw a zero-height bar, when a counter is zero', () => {
    const doc = buildFakeDoc(['rect', 'fill', 'fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 0,
      eventsProcessed: 0,
      successfulEvents: 0,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    drawStatusBreakdownChart(doc as never, stats);

    expect(doc.rect).toHaveBeenCalledWith(50, 100 + 120, 60, 0);
  });

  it('should advance doc.y below the fixed-height chart area, when called', () => {
    const doc = buildFakeDoc(['rect', 'fill', 'fillColor']);
    const stats: IStatsResult = {
      archivesProcessed: 1,
      eventsProcessed: 1,
      successfulEvents: 1,
      invalidEvents: 0,
      errors: 0,
      timeSeries: [],
      degraded: false,
    };

    drawStatusBreakdownChart(doc as never, stats);

    expect(doc.y).toBe(100 + 120 + 25);
  });
});

describe('selectTickIndices', () => {
  it('should return no indices, when there are no points', () => {
    expect(selectTickIndices(0, 4)).toEqual([]);
  });

  it('should return the only index, when there is one point', () => {
    expect(selectTickIndices(1, 4)).toEqual([0]);
  });

  it('should return both indices, when there are two points', () => {
    expect(selectTickIndices(2, 4)).toEqual([0, 1]);
  });

  it('should return every index, when the point count does not exceed the tick budget', () => {
    expect(selectTickIndices(3, 4)).toEqual([0, 1, 2]);
  });

  it('should sample evenly and always include the first and last index, when the point count exceeds the tick budget', () => {
    expect(selectTickIndices(50, 4)).toEqual([0, 16, 33, 49]);
  });
});

describe('maxTicksForWidth', () => {
  it('should fit as many ticks as the axis width allows, when the label width divides evenly', () => {
    expect(maxTicksForWidth(400, 50)).toBe(8);
  });

  it('should never return fewer than two ticks, when the axis is narrower than two labels', () => {
    expect(maxTicksForWidth(50, 60)).toBe(2);
  });

  it('should return an integer count, when the division is fractional', () => {
    expect(maxTicksForWidth(400, 60)).toBe(6);
  });
});

describe('formatAxisTimestamp', () => {
  it('should render month-day and hour-minute in UTC, when given a canonical ISO timestamp', () => {
    expect(formatAxisTimestamp('2026-08-11T13:45:00.000Z')).toBe('08-11 13:45');
  });
});
