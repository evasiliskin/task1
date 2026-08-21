import { buildErrorMetricKey, buildRequestMetricKey } from './metric-key.util.js';

describe('buildRequestMetricKey', () => {
  it('should normalise hyphens in the service name to underscores, when the service name is kebab-case', () => {
    expect(buildRequestMetricKey('service-a', 'events.search')).toBe(
      'service_a.rmq.events.search.requests',
    );
  });

  it('should preserve the dots inside the pattern, when the pattern is multi-segment', () => {
    expect(buildRequestMetricKey('service-b', 'reports.pdf.generate')).toBe(
      'service_b.rmq.reports.pdf.generate.requests',
    );
  });

  it('should leave the service name unchanged, when it contains no hyphens', () => {
    expect(buildRequestMetricKey('gateway', 'stats.get')).toBe('gateway.rmq.stats.get.requests');
  });
});

describe('buildErrorMetricKey', () => {
  it('should build an errors key for the same service and pattern, when called', () => {
    expect(buildErrorMetricKey('service-a', 'archive.import.download')).toBe(
      'service_a.rmq.archive.import.download.errors',
    );
  });

  it('should differ from the request key only in the final segment, when called with the same inputs', () => {
    expect(buildErrorMetricKey('service-a', 'imports.claim')).toBe(
      buildRequestMetricKey('service-a', 'imports.claim').replace(/\.requests$/, '.errors'),
    );
  });
});
