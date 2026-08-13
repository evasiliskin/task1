import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface ILogEntryView {
  importId: string;
  eventType: string;
  service: string;
  status: string;
  timestamp: string;
  correlationId: string;
  archive: string;
  metadata: Record<string, number>;
  errorInfo?: { reason: string };
}

export class LogResponseDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly importId: string;

  @ApiProperty({ example: 'github.import.completed' })
  public readonly eventType: string;

  @ApiProperty({ example: 'service-a' })
  public readonly service: string;

  @ApiProperty({ example: 'completed' })
  public readonly status: string;

  @ApiProperty({ example: '2026-08-11T00:05:00.000Z' })
  public readonly timestamp: string;

  @ApiProperty({ example: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly correlationId: string;

  @ApiProperty({ example: '2026-08-11-0.json.gz' })
  public readonly archive: string;

  @ApiProperty({ type: Object, example: { eventsProcessed: 10, validEvents: 8 } })
  public readonly metadata: Record<string, number>;

  @ApiPropertyOptional({ example: { reason: 'download failed: 404 Not Found' } })
  public readonly errorInfo?: { reason: string };

  public constructor(document: ILogEntryView) {
    this.importId = document.importId;
    this.eventType = document.eventType;
    this.service = document.service;
    this.status = document.status;
    this.timestamp = document.timestamp;
    this.correlationId = document.correlationId;
    this.archive = document.archive;
    this.metadata = document.metadata;

    if (document.errorInfo !== undefined) {
      this.errorInfo = document.errorInfo;
    }
  }
}
