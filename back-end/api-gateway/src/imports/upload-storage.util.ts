export const TEMP_UPLOAD_FILE_SUFFIX = '.tmp';

const ARCHIVE_FILENAME_PATTERN = /\.json\.gz$/i;

export function isArchiveFilename(filename: string): boolean {
  return ARCHIVE_FILENAME_PATTERN.test(filename);
}

export function buildTemporaryUploadFilename(importId: string): string {
  return `${importId}${TEMP_UPLOAD_FILE_SUFFIX}`;
}

export function parseImportIdFromTemporaryFilename(filename: string): string {
  return filename.slice(0, -TEMP_UPLOAD_FILE_SUFFIX.length);
}

export function buildFinalArchiveFilename(importId: string): string {
  return `${importId}.json.gz`;
}
