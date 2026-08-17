import { type ArchiveConfiguration } from '../config/archive.config.js';

const STALENESS_MULTIPLIER = 3;

export function computeImportRunStalenessMs(configuration: ArchiveConfiguration): number {
  return configuration.downloadTotalTimeoutMs * STALENESS_MULTIPLIER;
}
