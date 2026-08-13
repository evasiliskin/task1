import { IsOptional, IsUUID } from 'class-validator';

export class GetStatsQueryDto {
  @IsOptional()
  @IsUUID()
  public readonly importId?: string;
}
