import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const LOG_STATUSES = ['started', 'completed', 'failed', 'dead-lettered'] as const;

export class SearchLogsQueryDto {
  @IsOptional()
  @IsUUID()
  public readonly importId?: string;

  @IsOptional()
  @IsIn(LOG_STATUSES)
  public readonly status?: (typeof LOG_STATUSES)[number];

  @IsOptional()
  @IsISO8601()
  public readonly from?: string;

  @IsOptional()
  @IsISO8601()
  public readonly to?: string;

  @IsOptional()
  @IsString()
  public readonly cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  public readonly limit: number = DEFAULT_LIMIT;
}
