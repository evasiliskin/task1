import { ApiProperty } from '@nestjs/swagger';

export class TriggerImportResponseDto {
  @ApiProperty({
    description: 'Public identifier of the newly created (or replayed) import run',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  public readonly importId: string;

  public constructor(importId: string) {
    this.importId = importId;
  }
}
