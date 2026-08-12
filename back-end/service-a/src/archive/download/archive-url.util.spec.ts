import { buildArchiveUrl } from './archive-url.util.js';
import { InvalidDateHourError } from './errors.js';

describe('buildArchiveUrl', () => {
  const baseUrl = 'https://data.gharchive.org';

  it('should build the archive URL, when dateHour has a single-digit hour', () => {
    expect(buildArchiveUrl('2026-08-11-0', baseUrl)).toBe(
      'https://data.gharchive.org/2026-08-11-0.json.gz',
    );
  });

  it('should build the archive URL, when dateHour has a two-digit hour', () => {
    expect(buildArchiveUrl('2026-08-11-23', baseUrl)).toBe(
      'https://data.gharchive.org/2026-08-11-23.json.gz',
    );
  });

  it('should throw InvalidDateHourError, when the date portion is malformed', () => {
    expect(() => buildArchiveUrl('26-08-11-0', baseUrl)).toThrow(InvalidDateHourError);
  });

  it('should throw InvalidDateHourError, when the hour is 24 or greater', () => {
    expect(() => buildArchiveUrl('2026-08-11-24', baseUrl)).toThrow(InvalidDateHourError);
  });

  it('should throw InvalidDateHourError, when the hour has a leading zero', () => {
    expect(() => buildArchiveUrl('2026-08-11-05', baseUrl)).toThrow(InvalidDateHourError);
  });

  it('should throw InvalidDateHourError, when dateHour is an empty string', () => {
    expect(() => buildArchiveUrl('', baseUrl)).toThrow(InvalidDateHourError);
  });
});
