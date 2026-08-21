export const UPLOAD_TEMP_SUFFIX = '.upload.tmp';
export const DOWNLOAD_TEMP_SUFFIX = '.download.tmp';
export const ARCHIVE_SUFFIX = '.json.gz';

export function buildUploadTemporaryFilename(importId: string): string {
  return `${importId}${UPLOAD_TEMP_SUFFIX}`;
}

export function buildDownloadTemporaryFilename(importId: string): string {
  return `${importId}${DOWNLOAD_TEMP_SUFFIX}`;
}

export function buildArchiveFilename(importId: string): string {
  return `${importId}${ARCHIVE_SUFFIX}`;
}

export function parseImportIdFromUploadTemporaryFilename(filename: string): string {
  return filename.slice(0, -UPLOAD_TEMP_SUFFIX.length);
}

export function isUploadTemporaryFile(filename: string): boolean {
  return filename.endsWith(UPLOAD_TEMP_SUFFIX);
}

export function isDownloadTemporaryFile(filename: string): boolean {
  return filename.endsWith(DOWNLOAD_TEMP_SUFFIX);
}

export function isFinalArchiveFile(filename: string): boolean {
  return filename.endsWith(ARCHIVE_SUFFIX);
}
