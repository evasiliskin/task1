import { type IEventView, type IGithubEventDocument } from '@task1/shared/github-archive/index';

export function toEventView(document: IGithubEventDocument): IEventView {
  return {
    eventId: document.eventId,
    eventType: document.eventType,
    createdAt: document.createdAt.toISOString(),
    actor: document.actor,
    repo: document.repo,
    ...(document.org === undefined ? {} : { org: document.org }),
    importId: document.importId,
    payload: document.payload,
  };
}
