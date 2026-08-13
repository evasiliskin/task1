import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LogResponseDto } from './log-response.dto.js';

export class SearchLogsResponseDto {
  @ApiProperty({ type: [LogResponseDto] })
  public readonly data: LogResponseDto[];

  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page; absent when no more results exist',

    example:
      'eyJ0aW1lc3RhbXAiOiIyMDI2LTA4LTExVDAwOjAwOjAwLjAwMFoiLCJpZCI6IjY0YjdmMGMyZjFhMmIzYzRkNWU2ZjdhMSJ9',
  })
  public readonly nextCursor?: string;

  public constructor(data: LogResponseDto[], nextCursor?: string) {
    this.data = data;

    if (nextCursor !== undefined) {
      this.nextCursor = nextCursor;
    }
  }
}
