import {
  type IGithubActor,
  type IGithubOrganization,
  type IGithubRepository,
} from './github-event.dto.js';

/**
 * What `events.search` actually puts on the wire.
 *
 * Distinct from `IGithubEventDocument`: that describes a MongoDB document, this describes a message
 * contract, and they disagree on `createdAt` — a `Date` in the collection, an ISO string after JSON
 * serialisation. Sharing one type made a persistence rename a silent API change.
 */
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
