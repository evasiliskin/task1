export const COMMAND_PATTERNS = {
  ARCHIVE_IMPORT_DOWNLOAD: 'archive.import.download',
  ARCHIVE_PROCESS_UPLOAD: 'archive.process.upload',
} as const;

export type CommandPattern = (typeof COMMAND_PATTERNS)[keyof typeof COMMAND_PATTERNS];
