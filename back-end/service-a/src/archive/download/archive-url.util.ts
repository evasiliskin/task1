import { InvalidDateHourError } from './errors.js';

const DATE_HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$/;

export function buildArchiveUrl(dateHour: string, baseUrl: string): string {
  if (!DATE_HOUR_PATTERN.test(dateHour)) {
    throw new InvalidDateHourError(dateHour);
  }

  return `${baseUrl}/${dateHour}.json.gz`;
}
