import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EventResponseDto } from './event-response.dto.js';

export class SearchEventsResponseDto {
  @ApiProperty({ type: [EventResponseDto] })
  public readonly data: EventResponseDto[];

  @ApiPropertyOptional({
    description: 'Opaque cursor for the next page; absent when no more results exist',
    // eslint-disable-next-line no-secrets/no-secrets -- a base64url Swagger example value, not a secret
    example: 'eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTExVDAwOjAwOjAwLjAwMFoiLCJldmVudElkIjoiZTEifQ',
  })
  public readonly nextCursor?: string;

  public constructor(data: EventResponseDto[], nextCursor?: string) {
    this.data = data;

    if (nextCursor !== undefined) {
      this.nextCursor = nextCursor;
    }
  }
}
