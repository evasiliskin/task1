import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface IStatsTimeSeriesPointView {
  timestamp: string;
  value: number;
}

export interface IStatsView {
  archivesProcessed: number;
  eventsProcessed: number;
  successfulEvents: number;
  invalidEvents: number;
  errors: number;
  processingDurationMs?: number;
  timeSeries: IStatsTimeSeriesPointView[];
}

export class StatsTimeSeriesPointDto {
  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' })
  public readonly timestamp: string;

  @ApiProperty({ example: 42 })
  public readonly value: number;

  public constructor(point: IStatsTimeSeriesPointView) {
    this.timestamp = point.timestamp;
    this.value = point.value;
  }
}

export class StatsResponseDto {
  @ApiProperty({ example: 12 })
  public readonly archivesProcessed: number;

  @ApiProperty({ example: 48_000 })
  public readonly eventsProcessed: number;

  @ApiProperty({ example: 47_500 })
  public readonly successfulEvents: number;

  @ApiProperty({ example: 500 })
  public readonly invalidEvents: number;

  @ApiProperty({ example: 3 })
  public readonly errors: number;

  @ApiPropertyOptional({ example: 15_230 })
  public readonly processingDurationMs?: number;

  @ApiProperty({ type: [StatsTimeSeriesPointDto] })
  public readonly timeSeries: StatsTimeSeriesPointDto[];

  public constructor(view: IStatsView) {
    this.archivesProcessed = view.archivesProcessed;
    this.eventsProcessed = view.eventsProcessed;
    this.successfulEvents = view.successfulEvents;
    this.invalidEvents = view.invalidEvents;
    this.errors = view.errors;
    this.timeSeries = view.timeSeries.map((point) => new StatsTimeSeriesPointDto(point));

    if (view.processingDurationMs !== undefined) {
      this.processingDurationMs = view.processingDurationMs;
    }
  }
}
