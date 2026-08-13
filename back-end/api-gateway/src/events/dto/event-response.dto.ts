import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  type IGithubActor,
  type IGithubEventDocument,
  type IGithubOrganization,
  type IGithubRepository,
} from '@task1/shared/github-archive/index';

export class EventResponseDto {
  @ApiProperty({ example: '11111111111' })
  public readonly eventId: string;

  @ApiProperty({ example: 'PushEvent' })
  public readonly eventType: string;

  @ApiProperty({ example: '2026-08-11T00:00:00.000Z' })
  public readonly createdAt: string;

  @ApiProperty({ example: { id: 1, login: 'octocat' } })
  public readonly actor: IGithubActor;

  @ApiProperty({ example: { id: 2, name: 'octocat/hello-world' } })
  public readonly repo: IGithubRepository;

  @ApiPropertyOptional({ example: { id: 3, login: 'octo-org' } })
  public readonly org?: IGithubOrganization;

  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  public readonly importId: string;

  @ApiProperty({ type: Object, example: { ref: 'refs/heads/main', commitCount: 3 } })
  public readonly payload: Record<string, unknown>;

  public constructor(document: Omit<IGithubEventDocument, 'createdAt'> & { createdAt: string }) {
    this.eventId = document.eventId;
    this.eventType = document.eventType;
    this.createdAt = document.createdAt;
    this.actor = document.actor;
    this.repo = document.repo;
    this.importId = document.importId;
    this.payload = document.payload;

    if (document.org !== undefined) {
      this.org = document.org;
    }
  }
}
