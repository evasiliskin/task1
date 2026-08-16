/**
 * The filename contract for the shared archive volume.
 *
 * The gateway and service-a both write into `STORAGE_DIR`. A single `.tmp` suffix cannot say which
 * of them owns a file, so service-a's startup sweep used to delete the gateway's in-flight uploads.
 * Distinct per-producer suffixes are what let each service sweep only what it wrote.
 *
 * Owner map:
 *   `<importId>.upload.tmp`    api-gateway, while multer is still writing (buildUploadTemporaryFilename)
 *   `<importId>.download.tmp`  service-a, while the GH Archive download is streaming (buildDownloadTemporaryFilename)
 *   `<importId>.json.gz`       whichever producer finalised it; deleted by service-a on a
 *                              successful import, otherwise collected by the gateway's retention
 *                              sweep
 */
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
