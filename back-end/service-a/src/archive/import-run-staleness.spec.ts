import { type ArchiveConfiguration } from '../config/archive.config.js';

import { computeImportRunStalenessMs } from './import-run-staleness.js';

function buildConfiguration(downloadTotalTimeoutMs: number): ArchiveConfiguration {
  return { downloadTotalTimeoutMs } as ArchiveConfiguration;
}

describe('computeImportRunStalenessMs', () => {
  it('should return a multiple of the total download timeout, when a configuration is given', () => {
    expect(computeImportRunStalenessMs(buildConfiguration(600_000))).toBe(1_800_000);
  });

  it('should stay longer than a single download attempt, when the timeout is small', () => {
    const downloadTotalTimeoutMs = 1000;

    expect(computeImportRunStalenessMs(buildConfiguration(downloadTotalTimeoutMs))).toBeGreaterThan(
      downloadTotalTimeoutMs,
    );
  });
});
