import { type IGithubEventDocument } from '@task1/shared/github-archive/index';

import { type RawGithubEvent } from './raw-github-event.schema.js';

const ISSUE_TITLE_MAX_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildPayload(rawEvent: RawGithubEvent): Record<string, unknown> {
  switch (rawEvent.type) {
    case 'PushEvent': {
      const commits = rawEvent.payload.commits;
      const reference = rawEvent.payload.ref;

      return {
        ref: typeof reference === 'string' ? reference : '',
        commitCount: Array.isArray(commits) ? commits.length : 0,
      };
    }

    case 'IssuesEvent': {
      const action = rawEvent.payload.action;
      const issue = rawEvent.payload.issue;
      const issueTitle = isRecord(issue) && typeof issue.title === 'string' ? issue.title : '';

      return {
        action: typeof action === 'string' ? action : '',
        issueTitle: issueTitle.slice(0, ISSUE_TITLE_MAX_LENGTH),
      };
    }

    default:
      return {};
  }
}

export function transformEvent(rawEvent: RawGithubEvent, importId: string): IGithubEventDocument {
  return {
    eventId: rawEvent.id,
    eventType: rawEvent.type,
    createdAt: new Date(rawEvent.created_at),
    actor: rawEvent.actor,
    repo: rawEvent.repo,
    importId,
    payload: buildPayload(rawEvent),
    ...(rawEvent.org === undefined ? {} : { org: rawEvent.org }),
  };
}
