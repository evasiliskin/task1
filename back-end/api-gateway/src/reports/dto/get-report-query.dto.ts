import { IsOptional, IsUUID } from 'class-validator';

export class GetReportQueryDto {
  @IsOptional()
  @IsUUID()
  public readonly importId?: string;
}
