import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface IImportStatusSourceView {
  type: 'download' | 'upload';
  archive?: string;
  filename?: string;
}

export interface IImportStatusView {
  importId: string;
  source: IImportStatusSourceView;
  status: 'started' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  eventsProcessed?: number;
  validEvents?: number;
  invalidEvents?: number;
  duplicateEvents?: number;
  errorCount?: number;
  errorSamples?: string[];
}

export class ImportStatusResponseDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly importId: string;

  @ApiProperty({ type: Object, example: { type: 'download', archive: '2026-08-11-0.json.gz' } })
  public readonly source: IImportStatusSourceView;

  @ApiProperty({ example: 'completed' })
  public readonly status: 'started' | 'completed' | 'failed';

  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' })
  public readonly startedAt: string;

  @ApiPropertyOptional({ example: '2026-08-11T00:05:00.000Z' })
  public readonly completedAt?: string;

  @ApiPropertyOptional({ example: '2026-08-11T00:02:00.000Z' })
  public readonly failedAt?: string;

  @ApiPropertyOptional({ example: 48_000 })
  public readonly eventsProcessed?: number;

  @ApiPropertyOptional({ example: 47_500 })
  public readonly validEvents?: number;

  @ApiPropertyOptional({ example: 500 })
  public readonly invalidEvents?: number;

  @ApiPropertyOptional({ example: 12 })
  public readonly duplicateEvents?: number;

  @ApiPropertyOptional({ example: 3 })
  public readonly errorCount?: number;

  @ApiPropertyOptional({ type: [String], example: ['download failed: 404 Not Found'] })
  public readonly errorSamples?: string[];

  public constructor(view: IImportStatusView) {
    this.importId = view.importId;
    this.source = view.source;
    this.status = view.status;
    this.startedAt = view.startedAt;

    if (view.completedAt !== undefined) {
      this.completedAt = view.completedAt;
    }

    if (view.failedAt !== undefined) {
      this.failedAt = view.failedAt;
    }

    if (view.eventsProcessed !== undefined) {
      this.eventsProcessed = view.eventsProcessed;
    }

    if (view.validEvents !== undefined) {
      this.validEvents = view.validEvents;
    }

    if (view.invalidEvents !== undefined) {
      this.invalidEvents = view.invalidEvents;
    }

    if (view.duplicateEvents !== undefined) {
      this.duplicateEvents = view.duplicateEvents;
    }

    if (view.errorCount !== undefined) {
      this.errorCount = view.errorCount;
    }

    if (view.errorSamples !== undefined) {
      this.errorSamples = view.errorSamples;
    }
  }
}
