import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const DATE_HOUR_PATTERN = /^\d{4}-\d{2}-\d{2}-([0-9]|1[0-9]|2[0-3])$/;

export class TriggerDownloadImportDto {
  @ApiProperty({
    description:
      'The GitHub Archive hour to import, formatted YYYY-MM-DD-H (hour 0-23, no leading zero).',
    example: '2026-08-11-0',
  })
  @Matches(DATE_HOUR_PATTERN, { message: 'dateHour must match YYYY-MM-DD-H (hour 0-23)' })
  public readonly dateHour!: string;
}
