const REQUEST_METRIC_SUFFIX = 'requests';
const ERROR_METRIC_SUFFIX = 'errors';

function normaliseServiceName(serviceName: string): string {
  return serviceName.replaceAll('-', '_');
}

function buildMetricKey(serviceName: string, pattern: string, suffix: string): string {
  return `${normaliseServiceName(serviceName)}.rmq.${pattern}.${suffix}`;
}

export function buildRequestMetricKey(serviceName: string, pattern: string): string {
  return buildMetricKey(serviceName, pattern, REQUEST_METRIC_SUFFIX);
}

export function buildErrorMetricKey(serviceName: string, pattern: string): string {
  return buildMetricKey(serviceName, pattern, ERROR_METRIC_SUFFIX);
}
