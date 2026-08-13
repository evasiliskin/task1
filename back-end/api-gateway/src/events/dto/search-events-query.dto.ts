import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class SearchEventsQueryDto {
  @IsOptional()
  @IsString()
  public readonly type?: string;

  @IsOptional()
  @IsString()
  public readonly repository?: string;

  @IsOptional()
  @IsString()
  public readonly actor?: string;

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
