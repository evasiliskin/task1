import {
  type IGithubActor,
  type IGithubOrganization,
  type IGithubRepository,
} from './github-event.dto.js';

export interface IEventView {
  eventId: string;
  eventType: string;
  createdAt: string;
  actor: IGithubActor;
  repo: IGithubRepository;
  org?: IGithubOrganization;
  importId: string;
  payload: Record<string, unknown>;
}
